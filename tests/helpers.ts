import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig, type Config } from '../src/config.js';
import { Engine, type Result } from '../src/engine.js';
import { signRequest } from '../src/security.js';

export const NOW = Date.parse('2026-10-09T09:00:00.000Z');
export const keys = { event: 'synthetic-event-key-not-a-live-secret-123', tool: 'synthetic-tool-key-not-a-live-secret-1234', operator: 'synthetic-operator-key-not-live-secret-12' };
export function fixtureConfig(dir: string): Config {
  return loadConfig({dbPath:join(dir,'core.sqlite'),providerDbPath:join(dir,'fake-provider.sqlite'),mode:'local',host:'127.0.0.1',tenants:[
    {route:'demo-a',id:'tenant-a',keys,budgetMicros:100_000,maxCalls:1000},
    {route:'demo-b',id:'tenant-b',keys:{event:keys.event+'b',tool:keys.tool+'b',operator:keys.operator+'b'},budgetMicros:100_000,maxCalls:1000}
  ]});
}
export function harness(){
 const dir=mkdtempSync(join(tmpdir(),'receptionist-test-')); const config=fixtureConfig(dir); let now=NOW;
 const logs:object[]=[];const engine=new Engine(config,{seedDemo:true,clock:()=>now,log:r=>logs.push(r)});
 return {dir,config,engine,logs,setNow:(n:number)=>{now=n;},close:()=>{engine.close();rmSync(dir,{recursive:true,force:true});}};
}
export function signed(engine:Engine,config:Config,role:'event'|'tool'|'operator',route:string,suffix:string,body:unknown,options:{timestamp?:number;signature?:string;raw?:string;method?:string}={}):Promise<Result>{
 const method=options.method??'POST';const path=`/v1/tenants/${route}/${suffix}`;
 const raw=options.raw??(body===undefined?'':JSON.stringify(body));const timestamp=String(options.timestamp??Math.floor(NOW/1000));
 const tenant=config.tenants.find(t=>t.route===route)!;
 const signature=options.signature??signRequest(tenant.keys[role],timestamp,method,path,Buffer.from(raw));
 return engine.request({method,path,body:Buffer.from(raw),headers:{'x-signature':signature,'x-timestamp':timestamp}});
}
export function event(id='evt-1',callId='call-1',type='call.started',data:object={}) {return {id,callId,type,occurredAt:new Date(NOW).toISOString(),data};}
export async function eligible(h:ReturnType<typeof harness>,callId='call-1',route='demo-a'){
 await signed(h.engine,h.config,'event',route,'events',event('start-'+callId,callId));
 await h.engine.drain();
 await signed(h.engine,h.config,'event',route,'events',event('intent-'+callId,callId,'intent.detected',{intent:'booking',confidence:0.95}));
 await h.engine.drain();
}
export async function reserve(h:ReturnType<typeof harness>,commandId='cmd-1',callId='call-1',slotId='slot-1',route='demo-a'){
 const confirmation=await signed(h.engine,h.config,'operator',route,'confirmations',{callId,slotId,attested:true,evidenceId:'synthetic-confirmation'});
 if(confirmation.status!==201)return confirmation;
 return signed(h.engine,h.config,'tool',route,'bookings',{commandId,callId,slotId,confirmationId:confirmation.body.confirmationId});
}
