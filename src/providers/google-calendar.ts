import { z } from 'zod';
import type { CalendarPort,LookupResult,Receipt } from '../ports.js';
import { ProviderFault } from '../fake-provider.js';
import { digest,canonical } from '../security.js';
export type CalendarRequest={method:'POST'|'GET';url:string;body?:string;signal:AbortSignal};
export interface CalendarTransport {readonly mode:'offline-contract-only'|'live';request(input:CalendarRequest):Promise<{status:number;body:string}>;}
export interface OfflineCalendarTransport extends CalendarTransport {readonly mode:'offline-contract-only';}
export type BookingDescriptor={tenant:string;command:string;slot:string;startMs:number;endMs:number};
const event=z.object({id:z.string(),status:z.literal('confirmed'),start:z.object({dateTime:z.string()}),end:z.object({dateTime:z.string()}),extendedProperties:z.object({private:z.object({command_hash:z.string(),booking_hash:z.string()})})});
/** Shared API mapping. Transport selection is trusted composition configuration only. */
export class GoogleCalendarContractAdapter implements CalendarPort {
 get providerMock(){return this.transport.mode==='offline-contract-only';}
 get integrationStatus(){return this.transport.mode==='live'?'live-unvalidated':'offline-contract-only';}
 constructor(private calendars:Readonly<Record<string,string>>,private resolve:(tenant:string,command:string)=>Promise<BookingDescriptor|undefined>,private transport:CalendarTransport,private timeoutMs=1000){
  if(!['offline-contract-only','live'].includes(transport.mode)||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||Object.values(calendars).some(x=>!x||x.length>256)||new Set(Object.values(calendars)).size!==Object.values(calendars).length)throw new Error('INVALID_OFFLINE_CALENDAR_CONFIG');
 }
 private async descriptor(tenant:string,command:string){const d=await this.resolve(tenant,command);if(!d||d.tenant!==tenant||d.command!==command||!this.calendars[tenant]||!Number.isSafeInteger(d.startMs)||!Number.isSafeInteger(d.endMs)||d.startMs<0||d.endMs<=d.startMs||d.endMs>8640000000000000)throw new ProviderFault('no_effect_terminal');return d;}
 private identity(d:BookingDescriptor){return {id:'b'+digest(canonical([d.tenant,d.command])),commandHash:digest(canonical([d.tenant,d.command])),bookingHash:digest(canonical(d))};}
 private path(tenant:string){return 'https://www.googleapis.com/calendar/v3/calendars/'+encodeURIComponent(this.calendars[tenant]!)+'/events';}
 private async request(method:'POST'|'GET',url:string,body?:string){
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([this.transport.request({method,url,signal:controller.signal,...(body===undefined?{}:{body})}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new ProviderFault('unknown'));},this.timeoutMs);})]);}
  catch{throw new ProviderFault('unknown');}finally{if(timer)clearTimeout(timer);}
 }
 private receipt(body:string,d:BookingDescriptor):Receipt|undefined{
  if(body.length>65536)return undefined;
  try{const result=event.safeParse(JSON.parse(body)),expected=this.identity(d);if(!result.success)return undefined;const e=result.data;
   if(e.id!==expected.id||e.extendedProperties.private.command_hash!==expected.commandHash||e.extendedProperties.private.booking_hash!==expected.bookingHash||Date.parse(e.start.dateTime)!==d.startMs||Date.parse(e.end.dateTime)!==d.endMs)return undefined;
   return {id:e.id,providerMock:this.providerMock};
  }catch{return undefined;}
 }
 async book(tenant:string,command:string,slot:string):Promise<Receipt>{
  const d=await this.descriptor(tenant,command);if(d.slot!==slot)throw new ProviderFault('no_effect_terminal');const identity=this.identity(d);
  const body=JSON.stringify({id:identity.id,summary:this.providerMock?'Sentetik bilgi görüşmesi':'Bilgi görüşmesi',start:{dateTime:new Date(d.startMs).toISOString(),timeZone:'Europe/Istanbul'},end:{dateTime:new Date(d.endMs).toISOString(),timeZone:'Europe/Istanbul'},extendedProperties:{private:{command_hash:identity.commandHash,booking_hash:identity.bookingHash}}});
  const response=await this.request('POST',this.path(tenant)+'?sendUpdates=none',body);
  if(response.status===200||response.status===201){const receipt=this.receipt(response.body,d);if(receipt)return receipt;throw new ProviderFault('unknown');}
  if(response.status===409){const result=await this.lookup(tenant,command);if(result.status==='confirmed')return result.receipt;throw new ProviderFault('unknown');}
  if(response.status===429)throw new ProviderFault('no_effect_retryable');
  if([400,401,403].includes(response.status)){
   if(response.status===403&&response.body.length<=65536){try{const error=JSON.parse(response.body);if(error.error?.errors?.some((x:{reason?:string})=>x.reason==='rateLimitExceeded'||x.reason==='userRateLimitExceeded'))throw new ProviderFault('no_effect_retryable');}catch(e){if(e instanceof ProviderFault)throw e;}}
   throw new ProviderFault('no_effect_terminal');
  }
  throw new ProviderFault('unknown');
 }
 async lookup(tenant:string,command:string):Promise<LookupResult>{
  try{const d=await this.descriptor(tenant,command),response=await this.request('GET',this.path(tenant)+'/'+this.identity(d).id);if(response.status===200){const receipt=this.receipt(response.body,d);if(receipt)return {status:'confirmed',receipt};}return {status:'unknown'};}catch{return {status:'unknown'};}
 }
}
