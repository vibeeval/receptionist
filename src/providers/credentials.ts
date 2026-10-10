import { digest,canonical } from '../security.js';
export const oauthClientBinding=(clientId:string)=>digest(canonical(['https://oauth2.googleapis.com/token',clientId]));
/** Google OAuth refresh contract: https://developers.google.com/identity/protocols/oauth2/web-server#offline */
export interface CredentialRecord {accessToken:string;refreshToken:string;expiresAt:number;generation:number;state:'ready'|'needs_reauth'|'refresh_pending';scopes:string[];clientBinding?:string;pending?:{owner:string;until:number}}
export interface CredentialSession {read():Promise<CredentialRecord|undefined>;write(record:CredentialRecord):Promise<void>}
/** The lock must span the callback across all processes; writes must be durable before resolution.
 * Implementations must protect tokens at rest and never log records. A lost refresh response can
 * strand a rotated grant: stop/re-authorize rather than inventing a successful refresh. */
export interface CredentialStore {exclusive<T>(fn:(session:CredentialSession)=>Promise<T>):Promise<T>}
export interface CredentialLease {accessToken:string;generation:number;expiresAt:number}
export interface CredentialProvider {get():Promise<CredentialLease>;invalidate(generation:number):Promise<void>;readiness():Promise<{ready:boolean;state:string;expiresAt?:number}>;close():Promise<void>}
export class CredentialError extends Error {constructor(readonly code:string){super(code);}}
const validSecret=(s:unknown):s is string=>typeof s==='string'&&s.length>0&&s.length<=8192&&!/[\r\n]/.test(s)&&!s.startsWith('REPLACE_');
export function environmentReference(ref:string,env:NodeJS.ProcessEnv=process.env):string {if(!/^env:[A-Z][A-Z0-9_]*$/.test(ref))throw new CredentialError('INVALID_SECRET_REFERENCE');const value=env[ref.slice(4)];if(!validSecret(value))throw new CredentialError('CREDENTIAL_REQUIRED');return value;}
export async function seedCredentialStore(store:CredentialStore,record:CredentialRecord):Promise<void>{validateRecord(record);await store.exclusive(async session=>{if(!await session.read())await session.write(record);});}
function validateRecord(r:CredentialRecord){if(!validSecret(r.refreshToken)||r.accessToken!==''&&!validSecret(r.accessToken)||!Number.isSafeInteger(r.generation)||r.generation<0||!Number.isFinite(r.expiresAt)||!Array.isArray(r.scopes)||r.scopes.some(s=>typeof s!=='string')||!['ready','needs_reauth','refresh_pending'].includes(r.state)||r.clientBinding!==undefined&&!/^[a-f0-9]{64}$/.test(r.clientBinding)||r.state==='refresh_pending'&&(!r.pending||typeof r.pending.owner!=='string'||!Number.isFinite(r.pending.until)))throw new CredentialError('INVALID_CREDENTIAL_RECORD');}
export class RefreshingCredentialProvider implements CredentialProvider {
 private flight:Promise<CredentialLease>|undefined;private closed=false;private state='uninitialized';private abort=new AbortController();
 constructor(private options:{store:CredentialStore;clientId:()=>Promise<string>;clientSecret:()=>Promise<string>;fetcher:typeof fetch;clock?:()=>number;requiredScopes:string[];skewMs?:number;timeoutMs?:number;attempts?:number}){if(!options.requiredScopes.length||(options.attempts??2)<1||(options.attempts??2)>3||(options.timeoutMs??3000)<1||(options.timeoutMs??3000)>30000||(options.skewMs??60000)<0)throw new CredentialError('INVALID_CREDENTIAL_OPTIONS');}
 private now(){return (this.options.clock??Date.now)();}
 get():Promise<CredentialLease>{if(this.closed)return Promise.reject(new CredentialError('CREDENTIAL_PROVIDER_CLOSED'));if(this.flight)return this.flight;this.flight=this.obtain().finally(()=>{this.flight=undefined;});return this.flight;}
 private async obtain():Promise<CredentialLease>{
  const waitDeadline=Date.now()+12000;const clientId=await this.options.clientId();if(this.closed)throw new CredentialError('CREDENTIAL_PROVIDER_CLOSED');if(!validSecret(clientId))throw new CredentialError('CREDENTIAL_REQUIRED');const binding=oauthClientBinding(clientId);
  try{for(;;){
   if(this.closed)throw new CredentialError('CREDENTIAL_PROVIDER_CLOSED');
   const claim=await this.options.store.exclusive(async session=>{
    let record=await session.read();if(this.closed)throw new CredentialError('CREDENTIAL_PROVIDER_CLOSED');if(!record)throw new CredentialError('CREDENTIAL_REQUIRED');validateRecord(record);if(record.clientBinding&&record.clientBinding!==binding)throw new CredentialError('OAUTH_CLIENT_BINDING_MISMATCH');if(!record.clientBinding){record={...record,clientBinding:binding};await session.write(record);}
    if(record.state==='needs_reauth')throw new CredentialError('NEEDS_REAUTH');
    if(record.state==='refresh_pending'){
     if(record.pending!.until<=this.now()){await session.write({...record,accessToken:'',expiresAt:0,state:'needs_reauth'});throw new CredentialError('NEEDS_REAUTH');}
     return {kind:'wait' as const};
    }
    if(!this.options.requiredScopes.every(s=>record.scopes.includes(s)))throw new CredentialError('INSUFFICIENT_SCOPE');
    if(record.accessToken&&record.expiresAt>this.now()+(this.options.skewMs??60000))return {kind:'lease' as const,record};
    const pending={owner:randomUUID(),until:this.now()+(this.options.timeoutMs??3000)*(this.options.attempts??2)+1000};
    const next:CredentialRecord={...record,state:'refresh_pending',generation:record.generation+1,pending};
    await session.write(next);return {kind:'refresh' as const,record:next};
   });
   if(claim.kind==='lease'){if(this.closed)throw new CredentialError('CREDENTIAL_PROVIDER_CLOSED');this.state='ready';return this.lease(claim.record);}
   if(claim.kind==='wait'){this.state='refreshing';if(Date.now()>=waitDeadline)throw new CredentialError('REFRESH_WAIT_TIMEOUT');await new Promise(r=>setTimeout(r,20));continue;}
   this.state='refreshing';return await this.executeRefresh(claim.record,clientId);
  }}catch(error){this.state=error instanceof CredentialError&&['NEEDS_REAUTH','INSUFFICIENT_SCOPE','CREDENTIAL_REQUIRED'].includes(error.code)?'needs_reauth':'unavailable';throw error instanceof CredentialError?error:new CredentialError('CREDENTIAL_STORE_UNAVAILABLE');}
 }
 private async executeRefresh(record:CredentialRecord,clientId:string):Promise<CredentialLease>{
  let response:Record<string,unknown>|undefined;
  try{
   for(let attempt=0;attempt<(this.options.attempts??2);attempt++){
    try{response=await this.refresh(record,clientId);break;}catch(error){if(!(error instanceof CredentialError)||error.code!=='REFRESH_RETRYABLE'||attempt+1===(this.options.attempts??2))throw error;}
   }
   if(!response||!validSecret(response.access_token)||response.token_type!=='Bearer'&&response.token_type!=='bearer'||typeof response.expires_in!=='number'||!Number.isFinite(response.expires_in)||response.expires_in<=0||response.expires_in>86400||response.refresh_token!==undefined&&!validSecret(response.refresh_token))throw new CredentialError('INVALID_REFRESH_RESPONSE');
   const scopes=typeof response.scope==='string'?response.scope.split(' ').filter(Boolean):record.scopes;
   if(!this.options.requiredScopes.every(s=>scopes.includes(s)))throw new CredentialError('INSUFFICIENT_SCOPE');
   const next:CredentialRecord={accessToken:response.access_token,refreshToken:typeof response.refresh_token==='string'?response.refresh_token:record.refreshToken,expiresAt:this.now()+response.expires_in*1000,generation:record.generation,state:'ready',scopes,clientBinding:record.clientBinding!};
   await this.options.store.exclusive(async session=>{const current=await session.read();if(!current||current.state!=='refresh_pending'||current.generation!==record.generation||current.pending?.owner!==record.pending?.owner||current.pending!.until<=this.now())throw new CredentialError('REFRESH_OWNERSHIP_LOST');await session.write(next);});
   if(this.closed)throw new CredentialError('CREDENTIAL_PROVIDER_CLOSED');this.state='ready';return this.lease(next);
  }catch(error){
   // Any unfinished committed intent is unsafe to replay, including crash/unknown rotation.
   await this.options.store.exclusive(async session=>{const current=await session.read();if(current?.state==='refresh_pending'&&current.generation===record.generation&&current.pending?.owner===record.pending?.owner)await session.write({...current,accessToken:'',expiresAt:0,state:error instanceof CredentialError&&['REFRESH_RETRYABLE','CLIENT_AUTH_REQUIRED'].includes(error.code)?'ready':'needs_reauth'});});
   throw this.closed?new CredentialError('CREDENTIAL_PROVIDER_CLOSED'):error instanceof CredentialError?error:new CredentialError('REFRESH_UNAVAILABLE');
  }
 }
 private lease(record:CredentialRecord):CredentialLease{return {accessToken:record.accessToken,generation:record.generation,expiresAt:record.expiresAt};}
 private async refresh(record:CredentialRecord,clientId:string):Promise<Record<string,unknown>>{
  const controller=new AbortController();const stop=()=>controller.abort();this.abort.signal.addEventListener('abort',stop,{once:true});if(this.closed)controller.abort();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.refreshRequest(record,controller.signal,clientId),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new CredentialError('REFRESH_TIMEOUT'));},this.options.timeoutMs??3000);controller.signal.addEventListener('abort',()=>reject(new CredentialError(this.closed?'CREDENTIAL_PROVIDER_CLOSED':'REFRESH_TIMEOUT')),{once:true});})]);}finally{if(timer)clearTimeout(timer);this.abort.signal.removeEventListener('abort',stop);controller.abort();}
 }
 private async refreshRequest(record:CredentialRecord,signal:AbortSignal,clientId:string):Promise<Record<string,unknown>>{
  const clientSecret=await this.options.clientSecret();if(!validSecret(clientId)||!validSecret(clientSecret))throw new CredentialError('CREDENTIAL_REQUIRED');signal.throwIfAborted();
  let response:Response;try{response=await this.options.fetcher('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:record.refreshToken,grant_type:'refresh_token'}),redirect:'error',signal});}catch{throw new CredentialError('REFRESH_TRANSPORT_UNKNOWN');}
  const reader=response.body?.getReader();let size=0,text='';const decoder=new TextDecoder();try{if(reader)for(;;){const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>32768)throw new CredentialError('INVALID_REFRESH_RESPONSE');text+=decoder.decode(chunk.value,{stream:true});}text+=decoder.decode();}finally{await reader?.cancel().catch(()=>{});}
  let value:Record<string,unknown>;try{value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw 0;}catch{throw new CredentialError('INVALID_REFRESH_RESPONSE');}
  if(value.error==='invalid_client')throw new CredentialError('CLIENT_AUTH_REQUIRED');
  if(value.error==='invalid_grant')throw new CredentialError('NEEDS_REAUTH');
  // Only explicit rate limiting/temporary denial is retried; timeout or network loss has unknown rotation outcome.
  if(response.status===429||value.error==='temporarily_unavailable')throw new CredentialError('REFRESH_RETRYABLE');
  if(response.status!==200)throw new CredentialError('REFRESH_REJECTED');return value;
 }
 async invalidate(generation:number){await this.options.store.exclusive(async session=>{const record=await session.read();if(record&&record.generation===generation&&record.state==='ready')await session.write({...record,expiresAt:0});});}
 async readiness(){try{return await this.options.store.exclusive(async session=>{const r=await session.read();if(!r)return {ready:false,state:'needs_reauth'};validateRecord(r);return {ready:!this.closed&&this.state!=='needs_reauth'&&this.state!=='unavailable'&&r.state==='ready'&&!!r.accessToken&&r.expiresAt>this.now()&&this.options.requiredScopes.every(s=>r.scopes.includes(s)),state:this.closed?'closed':r.state==='needs_reauth'?'needs_reauth':r.state==='refresh_pending'?'refreshing':r.expiresAt<=this.now()?'expired':this.state,expiresAt:r.expiresAt};});}catch{return {ready:false,state:'unavailable'};}}
 async close(){this.closed=true;this.abort.abort();await this.flight?.catch(()=>{});}
}

import { open,rename,mkdir,rm,stat } from 'node:fs/promises';
import { dirname,resolve } from 'node:path';
import { constants } from 'node:fs';
import { randomUUID } from 'node:crypto';
/** Single-host store. Directory must be dedicated and private. A crash-held lock fails closed;
 * operator may remove .lock only after stopping all instances (never time-steal a live refresh).
 * For automated crash recovery use a database advisory-lock CredentialStore implementation. */
export class AtomicFileCredentialStore implements CredentialStore {
 readonly path:string;
 constructor(path:string,private options:{lockTimeoutMs?:number}={}){this.path=resolve(path);}
 async exclusive<T>(fn:(session:CredentialSession)=>Promise<T>):Promise<T>{
  const dir=dirname(this.path);await mkdir(dir,{recursive:true,mode:0o700});const info=await stat(dir);if((info.mode&0o077)!==0)throw new CredentialError('CREDENTIAL_DIRECTORY_NOT_PRIVATE');
  const deadline=Date.now()+(this.options.lockTimeoutMs??15000),lock=this.path+'.lock';
  for(;;){try{await mkdir(lock,{mode:0o700});break;}catch(e){if((e as NodeJS.ErrnoException).code!=='EEXIST')throw new CredentialError('CREDENTIAL_STORE_UNAVAILABLE');if(Date.now()>=deadline)throw new CredentialError('CREDENTIAL_LOCK_TIMEOUT');await new Promise(r=>setTimeout(r,20));}}
  try{return await fn({read:async()=>{let handle;try{handle=await open(this.path,constants.O_RDONLY|constants.O_NOFOLLOW);const metadata=await handle.stat();if(!metadata.isFile()||(metadata.mode&0o077)!==0||metadata.size>65536)throw new CredentialError('CREDENTIAL_FILE_NOT_PRIVATE');const record=JSON.parse(await handle.readFile('utf8')) as CredentialRecord;validateRecord(record);return record;}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return undefined;throw new CredentialError('CREDENTIAL_STORE_UNAVAILABLE');}finally{await handle?.close();}},write:async record=>{validateRecord(record);const temp=this.path+'.'+randomUUID()+'.tmp';let handle;try{handle=await open(temp,'wx',0o600);await handle.writeFile(JSON.stringify(record));await handle.sync();await handle.close();handle=undefined;await rename(temp,this.path);const folder=await open(dir,'r');try{await folder.sync();}finally{await folder.close();}}finally{await handle?.close();await rm(temp,{force:true});}}});}finally{await rm(lock,{recursive:true});}
 }
}
export async function seedFromEnvironment(store:CredentialStore,refs:{accessTokenRef?:string;refreshTokenRef:string;expiresAt:number;scopes:string[];clientBinding?:string},env:NodeJS.ProcessEnv=process.env){await store.exclusive(async session=>{if(await session.read())return;const record:CredentialRecord={accessToken:refs.accessTokenRef?environmentReference(refs.accessTokenRef,env):'',refreshToken:environmentReference(refs.refreshTokenRef,env),expiresAt:refs.expiresAt,generation:0,state:'ready',scopes:refs.scopes};validateRecord(record);await session.write(record);});}
