import { migrateRetell } from './retell-migration.js';
import { Retell } from 'retell-sdk';
import { z } from 'zod';
import { randomBytes } from 'node:crypto';
import type { AsyncStore } from '../async-store.js';
import type { Config,Tenant } from '../config.js';
import type { Request,Result } from '../engine.js';
import { AppError,digest,signRequest } from '../security.js';
import { id } from '../contracts.js';
export async function verifyRetell(body:Buffer,signature:string|undefined,key:string){
 if(body.length>65536)throw new AppError(413,'BODY_TOO_LARGE');
 let raw:string;try{raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(body);}catch{throw new AppError(400,'INVALID_UTF8');}
 if(!signature||!/^v=\d{13},d=[a-f0-9]{64}$/i.test(signature))throw new AppError(401,'RETELL_SIGNATURE_INVALID');
 const timestamp=Number(signature.slice(2,15));
 if(!Number.isSafeInteger(timestamp)||Math.abs(Date.now()-timestamp)>300000||!await Retell.verify(raw,key,signature))throw new AppError(401,'RETELL_SIGNATURE_INVALID');
 return raw;
}
const providerId=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const timestamp=z.number().int().min(0).max(8640000000000000);
const callSchema=z.object({call_id:providerId,agent_id:providerId,start_timestamp:timestamp.optional(),end_timestamp:timestamp.optional()}); // strip provider PII/metadata
const lifecycle=z.object({event:z.enum(['call_started','call_ended','call_analyzed']),call:callSchema}).strict();
const tool=z.discriminatedUnion('name',[
 z.object({name:z.literal('book_appointment'),call:callSchema,args:z.object({capability:z.string().regex(/^[a-f0-9]{64}$/)}).strict()}).strict(),
 z.object({name:z.enum(['knowledge','slots','opt_out','request_human']),call:callSchema,args:z.object({}).strict()}).strict()
]);
const accountSchema=z.object({id:z.string().regex(/^[a-z0-9-]{1,32}$/),key:z.string().min(32).max(256).refine(v=>!v.startsWith('REPLACE_')),tenantRoute:z.string(),agentIds:z.array(providerId).min(1)}).strict();
export type RetellAccount=z.infer<typeof accountSchema>;
interface Core {readonly config:Config;request(r:Request):Promise<Result>;}
/** No SDK client is constructed; all transport remains in-process. Not mounted by default. */
export class RetellGateway {
 private constructor(private core:Core,private db:AsyncStore,private accounts:RetellAccount[],private now:()=>number){}
 static async open(core:Core,db:AsyncStore,input:RetellAccount[],now:()=>number=Date.now){
  const accounts=RetellGateway.validate(core,input);
  await migrateRetell(db);return new RetellGateway(core,db,accounts,now);
 }
 static validate(core:Core,input:RetellAccount[]){
  const accounts=z.array(accountSchema).min(1).parse(input);
  if(new Set(accounts.map(a=>a.id)).size!==accounts.length||new Set(accounts.map(a=>a.key)).size!==accounts.length||new Set(accounts.map(a=>a.tenantRoute)).size!==accounts.length)throw new Error('RETELL_ACCOUNT_ISOLATION_REQUIRED');
  const internalKeys=core.config.tenants.flatMap(t=>Object.values(t.keys));for(const a of accounts)if(!core.config.tenants.some(t=>t.route===a.tenantRoute)||internalKeys.includes(a.key)||new Set(a.agentIds).size!==a.agentIds.length)throw new Error('INVALID_RETELL_MAPPING');
  return accounts;
 }
 private account(id:string){const a=this.accounts.find(a=>a.id===id);if(!a)throw new AppError(404,'NOT_FOUND');return a;}
 private tenant(a:RetellAccount){return this.core.config.tenants.find(t=>t.route===a.tenantRoute)!;}
 private send(t:Tenant,role:'event'|'tool',suffix:string,payload:unknown,method='POST'){
  const body=Buffer.from(payload===undefined?'':JSON.stringify(payload)),path='/v1/tenants/'+t.route+'/'+suffix,ts=String(Math.floor(this.now()/1000));
  return this.core.request({method,path,body,headers:{'x-timestamp':ts,'x-signature':signRequest(t.keys[role],ts,method,path,body)}});
 }
 async handle(r:Request):Promise<Result>{try{
  const match=/^\/providers\/retell\/([a-z0-9-]+)\/(events|tools)$/.exec(r.path);if(!match)throw new AppError(404,'NOT_FOUND');if(r.method!=='POST')throw new AppError(405,'METHOD_NOT_ALLOWED');
  const a=this.account(match[1]!),t=this.tenant(a),raw=await verifyRetell(r.body,r.headers['x-retell-signature'],a.key);
  let input:unknown;try{input=JSON.parse(raw);}catch{throw new AppError(400,'INVALID_JSON');}
  if(match[2]==='events'){
   const parsed=lifecycle.safeParse(input);if(!parsed.success)throw new AppError(400,'INVALID_RETELL_EVENT');const e=parsed.data;
   if(!a.agentIds.includes(e.call.agent_id))throw new AppError(403,'AGENT_NOT_ALLOWED');
   const at=e.event==='call_started'?e.call.start_timestamp:e.call.end_timestamp;if(at===undefined||at>this.now()+300000)throw new AppError(400,'EVENT_TIMESTAMP_REQUIRED');
   const coreCall=digest(a.id+':'+e.call.call_id);
   await this.db.transaction(async()=>{const old=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',a.id,e.call.call_id);
    if(old&&(old.tenant!==t.id||old.agent!==e.call.agent_id))throw new AppError(409,'SESSION_BINDING_CONFLICT');
    await this.db.run('INSERT OR IGNORE INTO retell_sessions(account,provider_call,tenant,agent,core_call,closed) VALUES(?,?,?,?,?,?)',a.id,e.call.call_id,t.id,e.call.agent_id,coreCall,e.event==='call_started'?0:1);
    if(e.event!=='call_started'){await this.db.run('UPDATE retell_sessions SET closed=1 WHERE account=? AND provider_call=?',a.id,e.call.call_id);await this.db.run("INSERT OR IGNORE INTO booking_admission_gates VALUES(?,?,'provider_closed')",t.id,coreCall);}
   });
   return await this.send(t,'event','events',{id:digest(a.id+':'+e.call.call_id+':'+e.event),callId:coreCall,occurredAt:new Date(at).toISOString(),type:e.event==='call_started'?'call.started':'call.ended',data:{}});
  }
  const parsed=tool.safeParse(input);if(!parsed.success)throw new AppError(400,'INVALID_RETELL_TOOL');const inputTool=parsed.data;
  const session=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',a.id,inputTool.call.call_id);
  if(!session||session.tenant!==t.id||session.agent!==inputTool.call.agent_id||!a.agentIds.includes(inputTool.call.agent_id)||Number(session.closed)!==0)throw new AppError(403,'SESSION_NOT_ACTIVE');
  if(inputTool.name==='knowledge'||inputTool.name==='slots')return await this.send(t,'tool',inputTool.name,undefined,'GET');
  if(inputTool.name==='opt_out'||inputTool.name==='request_human')return await this.send(t,'event','events',{id:digest(a.id+':'+inputTool.call.call_id+':'+inputTool.name),callId:session.core_call,occurredAt:new Date(Number(inputTool.call.start_timestamp??0)).toISOString(),type:'intent.detected',data:{intent:inputTool.name==='opt_out'?'opt_out':'human',confidence:1}});
  const cap=await this.db.one('SELECT * FROM retell_capabilities WHERE token_hash=?',digest(inputTool.args.capability));
  if(!cap||cap.account!==a.id||cap.provider_call!==inputTool.call.call_id||cap.tenant!==t.id||cap.core_call!==session.core_call||Number(cap.expires_ms)<=this.now())throw new AppError(403,'MUTATION_CAPABILITY_REQUIRED');
  return await this.send(t,'tool','bookings',{commandId:cap.command_id,callId:cap.core_call,slotId:cap.slot_id,confirmationId:cap.confirmation_id});
 }catch(e){const x=e instanceof AppError?e:new AppError(503,'ADAPTER_UNAVAILABLE');return {status:x.status,body:{code:x.code,providerMock:true,integrationStatus:'offline-contract-only'}};}}
 /** Trusted operator-side composition only. No HTTP/tool route exposes this method. */
 async issueBookingCapability(account:string,providerCall:string,command:string,confirmation:string){
  id.parse(command);id.parse(confirmation);const a=this.account(account),t=this.tenant(a);
  return this.db.transaction(async()=>{const s=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',account,providerCall);
   if(!s||Number(s.closed)!==0||s.tenant!==t.id)throw new AppError(403,'SESSION_NOT_ACTIVE');
   const c=await this.db.one('SELECT * FROM confirmations WHERE tenant=? AND id=?',t.id,confirmation);
   if(!c||c.call_id!==s.core_call||c.used_by||Number(c.expires_ms)<=this.now()||await this.db.killed(t.id))throw new AppError(409,'CONFIRMATION_REQUIRED');
   const token=randomBytes(32).toString('hex');await this.db.run('INSERT INTO retell_capabilities VALUES(?,?,?,?,?,?,?,?,?)',digest(token),account,providerCall,t.id,s.core_call!,command,c.slot_id!,confirmation,Math.min(Number(c.expires_ms),this.now()+60000));
   await this.db.audit(t.id,'RETELL_MUTATION_CAPABILITY_ISSUED',command,this.now());return token;
  });
 }
}
