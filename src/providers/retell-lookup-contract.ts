import { Retell } from 'retell-sdk';
import { z } from 'zod';
export interface OfflineRetellTransport {readonly mode:'offline-contract-only';fetch:typeof fetch;}
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const snapshot=z.object({call_id:identifier,agent_id:identifier,call_status:z.enum(['registered','not_connected','ongoing','ended','error'])});
/** Read-only SDK transport probe. Reserved .invalid origin and synthetic key only.
 * Never used to create calls, buy numbers, or grant booking authorization. */
export class RetellLookupContract {
 private client:Retell;
 constructor(transport:OfflineRetellTransport,private timeoutMs=1000){
  if(!transport||typeof transport.fetch!=='function'||transport.mode!=='offline-contract-only'||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000)throw new Error('INVALID_OFFLINE_RETELL_CONFIG');
  this.client=new Retell({apiKey:'synthetic-contract-key-not-a-live-secret',baseURL:'https://retell-contract.invalid',fetch:transport.fetch,maxRetries:0,timeout:timeoutMs});
 }
 async lookup(callId:string,agentId:string){
  if(!identifier.safeParse(callId).success||!identifier.safeParse(agentId).success)return {status:'unavailable' as const,providerMock:true};
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{const raw=await Promise.race([this.client.call.retrieve(callId,{signal:controller.signal}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new Error('CONTRACT_TIMEOUT'));},this.timeoutMs);})]);const result=snapshot.safeParse(raw);
   if(!result.success||result.data.call_id!==callId||result.data.agent_id!==agentId)return {status:'unavailable' as const,providerMock:true};
   return {status:'synthetic-snapshot' as const,snapshot:result.data,providerMock:true};
  }catch{return {status:'unavailable' as const,providerMock:true};}finally{if(timer)clearTimeout(timer);}
 }
}
