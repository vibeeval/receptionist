import type { CredentialProvider } from './credentials.js';
import type { CalendarRequest,CalendarTransport } from './google-calendar.js';
/** Production HTTPS transport. Tests inject fetch; credentials resolved lazily per request. */
export class GoogleHttpsTransport implements CalendarTransport {
 readonly mode='live' as const;
 constructor(private token:(()=>Promise<string>)|CredentialProvider,private fetcher:typeof fetch=globalThis.fetch){if(typeof token!=='function'&&typeof token.get!=='function'||typeof fetcher!=='function')throw new Error('INVALID_GOOGLE_TRANSPORT');}
 async request(input:CalendarRequest){
  const u=new URL(input.url);
  if(!['POST','GET'].includes(input.method)||input.body!==undefined&&Buffer.byteLength(input.body)>65536)throw new Error('GOOGLE_REQUEST_REJECTED');
  if(u.origin!=='https://www.googleapis.com'||u.username||u.password||u.hash||!/^\/calendar\/v3\/calendars\/[^/]+\/events(?:\/b[a-f0-9]{64})?$/.test(u.pathname)||!['','?sendUpdates=none'].includes(u.search))throw new Error('GOOGLE_TARGET_REJECTED');
  const lease=typeof this.token==='function'?{accessToken:await this.token(),generation:0}:await this.token.get();const token=lease.accessToken;if(!token||token.length>8192||/[\r\n]/.test(token)||token.startsWith('REPLACE_'))throw new Error('GOOGLE_CREDENTIAL_REQUIRED');
  input.signal.throwIfAborted();
  let response=await this.fetcher(u,{method:input.method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(input.body===undefined?{}:{body:input.body}),signal:input.signal,redirect:'error'});
  // Only an explicit HTTP401 can replay this same deterministic request once. A thrown
  // fetch/body failure remains unknown and is recovered by Calendar GET, never re-POST.
  if(response.status===401&&typeof this.token!=='function'){await response.body?.cancel();await this.token.invalidate(lease.generation);const renewed=await this.token.get();input.signal.throwIfAborted();response=await this.fetcher(u,{method:input.method,headers:{Authorization:'Bearer '+renewed.accessToken,'Content-Type':'application/json'},...(input.body===undefined?{}:{body:input.body}),signal:input.signal,redirect:'error'});if(response.status===401)await this.token.invalidate(renewed.generation);}
  if(response.status>=300&&response.status<400)throw new Error('GOOGLE_REDIRECT_REJECTED');
  const reader=response.body?.getReader();let text='',size=0;const decoder=new TextDecoder();
  if(reader){try{for(;;){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>65536)throw new Error('GOOGLE_RESPONSE_TOO_LARGE');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel().catch(()=>{});}}
  return {status:response.status,body:text};
 }
}
