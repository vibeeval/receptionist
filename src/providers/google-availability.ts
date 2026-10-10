import type { CredentialProvider } from './credentials.js';
import { z } from 'zod';

export const GOOGLE_FREEBUSY_SCOPE='https://www.googleapis.com/auth/calendar.events.freebusy';
export type AvailabilitySlot={startMs:number;endMs:number};
export interface AvailabilityPort {
 available<T extends AvailabilitySlot>(tenant:string,slots:readonly T[]):Promise<T[]>;
 recheck(tenant:string,slot:AvailabilitySlot):Promise<boolean>;
}
export class AvailabilityUnavailable extends Error {constructor(){super('CALENDAR_AVAILABILITY_UNAVAILABLE');this.name='AvailabilityUnavailable';}}
const dateTime=z.string().datetime({offset:true}).refine(x=>Number.isFinite(Date.parse(x)));
const responseSchema=z.object({kind:z.literal('calendar#freeBusy'),timeMin:dateTime,timeMax:dateTime,calendars:z.record(z.string(),z.object({errors:z.array(z.unknown()).optional(),busy:z.array(z.object({start:dateTime,end:dateTime})).max(5000)})),groups:z.record(z.string(),z.object({errors:z.array(z.unknown()).optional()})).optional()});
/** Google freeBusy is a read, not a lock. Recheck immediately before the first
 * booking POST; never use a failed recheck to discard an unknown prior POST.
 * An external writer can still insert between this read and our event insert.
 * Contract: https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query */
export class GoogleAvailability implements AvailabilityPort {
 private readonly calendars:Readonly<Record<string,string>>;
 constructor(calendars:Readonly<Record<string,string>>,private token:(()=>Promise<string>)|CredentialProvider,private fetcher:typeof fetch=globalThis.fetch,private clock:()=>number=Date.now,private timeoutMs=3000){
  if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>10000||(typeof token!=='function'&&typeof token.get!=='function')||typeof fetcher!=='function'||typeof clock!=='function'||Object.values(calendars).some(x=>!x||x.length>256||/[\r\n]/.test(x)))throw new Error('INVALID_AVAILABILITY_CONFIG');
  this.calendars=Object.freeze({...calendars});
 }
 async available<T extends AvailabilitySlot>(tenant:string,slots:readonly T[]):Promise<T[]>{
  const calendar=Object.hasOwn(this.calendars,tenant)?this.calendars[tenant]:undefined;
  if(!calendar||slots.length>1000||slots.some(s=>!Number.isSafeInteger(s.startMs)||!Number.isSafeInteger(s.endMs)||s.startMs<0||s.endMs<=s.startMs||s.endMs>8640000000000000))throw new AvailabilityUnavailable();
  const now=this.clock();if(!Number.isFinite(now))throw new AvailabilityUnavailable();
  const candidates=slots.filter(s=>s.startMs>now);if(!candidates.length)return [];
  const startMs=Math.min(...candidates.map(s=>s.startMs)),endMs=Math.max(...candidates.map(s=>s.endMs));
  if(endMs-startMs>31*86400000)throw new AvailabilityUnavailable();
  const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
  const run=async()=>{
   const lease=typeof this.token==='function'?{accessToken:await this.token(),generation:0}:await this.token.get();const token=lease.accessToken;controller.signal.throwIfAborted();
   if(!token||token.length>8192||/[\r\n]/.test(token)||token.startsWith('REPLACE_'))throw new AvailabilityUnavailable();
   const dispatch=(value:string)=>this.fetcher('https://www.googleapis.com/calendar/v3/freeBusy',{method:'POST',redirect:'error',signal:controller.signal,headers:{Authorization:'Bearer '+value,'Content-Type':'application/json'},body:JSON.stringify({timeMin:new Date(startMs).toISOString(),timeMax:new Date(endMs).toISOString(),timeZone:'UTC',calendarExpansionMax:1,items:[{id:calendar}]})});
   let response=await dispatch(token);if(response.status===401&&typeof this.token!=='function'){await response.body?.cancel();await this.token.invalidate(lease.generation);const next=await this.token.get();controller.signal.throwIfAborted();response=await dispatch(next.accessToken);if(response.status===401)await this.token.invalidate(next.generation);}
   if(response.status!==200){await response.body?.cancel().catch(()=>{});throw new AvailabilityUnavailable();}
   const reader=response.body?.getReader();if(!reader)throw new AvailabilityUnavailable();let body='',size=0;const decoder=new TextDecoder('utf-8',{fatal:true});
   const cancel=()=>{void reader.cancel().catch(()=>{});};controller.signal.addEventListener('abort',cancel,{once:true});
   try{for(;;){controller.signal.throwIfAborted();const chunk=await reader.read();if(chunk.done)break;size+=chunk.value.byteLength;if(size>65536)throw new AvailabilityUnavailable();body+=decoder.decode(chunk.value,{stream:true});}body+=decoder.decode();}finally{controller.signal.removeEventListener('abort',cancel);cancel();}
   const parsed=responseSchema.parse(JSON.parse(body)),entry=parsed.calendars[calendar];
   if(Date.parse(parsed.timeMin)!==startMs||Date.parse(parsed.timeMax)!==endMs||!Object.hasOwn(parsed.calendars,calendar)||!entry||entry.errors?.length||Object.values(parsed.groups??{}).some(g=>g.errors?.length))throw new AvailabilityUnavailable();
   const busy=entry.busy.map(b=>({startMs:Date.parse(b.start),endMs:Date.parse(b.end)}));if(busy.some(b=>b.endMs<=b.startMs))throw new AvailabilityUnavailable();
   const checkedAt=this.clock();if(!Number.isFinite(checkedAt)||checkedAt<now)throw new AvailabilityUnavailable();
   return candidates.filter(s=>s.startMs>checkedAt&&!busy.some(b=>s.startMs<b.endMs&&s.endMs>b.startMs));
  };
  try{return await Promise.race([run(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(new AvailabilityUnavailable());},this.timeoutMs);})]);}
  catch{throw new AvailabilityUnavailable();}finally{if(timer)clearTimeout(timer);controller.abort();}
 }
 async recheck(tenant:string,slot:AvailabilitySlot):Promise<boolean>{return (await this.available(tenant,[slot])).length===1;}
}
