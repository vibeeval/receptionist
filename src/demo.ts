import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.js';
import { Engine } from './engine.js';
import { startServer } from './server.js';
import { signRequest } from './security.js';
const dir=mkdtempSync(join(tmpdir(),'receptionist-offline-'));
const now=Date.parse('2026-10-09T09:00:00Z');
const keys={event:randomBytes(32).toString('hex'),tool:randomBytes(32).toString('hex'),operator:randomBytes(32).toString('hex')};
const engine=new Engine(loadConfig({mode:'local',host:'127.0.0.1',dbPath:join(dir,'core.sqlite'),providerDbPath:join(dir,'fake.sqlite'),tenants:[{id:'fictional-demo',route:'demo',keys,budgetMicros:10000,maxCalls:10}]}),{seedDemo:true,clock:()=>now});
const server=await startServer(engine);
async function send(role:keyof typeof keys,suffix:string,payload:object){const path='/v1/tenants/demo/'+suffix,body=JSON.stringify(payload),ts=String(now/1000);const r=await fetch(server.url+path,{method:'POST',body,headers:{'content-type':'application/json','x-timestamp':ts,'x-signature':signRequest(keys[role],ts,'POST',path,Buffer.from(body))}});if(!r.ok)throw new Error('DEMO_REQUEST_FAILED_'+r.status);return r.json()as Promise<Record<string,unknown>>;}
try{
 const base={callId:'fictional-call',occurredAt:new Date(now).toISOString()};
 await send('event','events',{...base,id:'start',type:'call.started',data:{}});await engine.drain();
 await send('event','events',{...base,id:'intent',type:'intent.detected',data:{intent:'booking',confidence:.95}});await engine.drain();
 const confirmation=await send('operator','confirmations',{callId:base.callId,slotId:'slot-1',attested:true,evidenceId:'fictional-user-confirmation'});
 await send('tool','bookings',{commandId:'fictional-command',callId:base.callId,slotId:'slot-1',confirmationId:confirmation.confirmationId});await engine.drain();
 console.log(JSON.stringify({mode:'OFFLINE_SYNTHETIC_DEMO',transport:'actual loopback HTTP',database:'disk SQLite',voice:'NOT IMPLEMENTED',booking:engine.store.command('fictional-demo','fictional-command')?.state,providerMock:true,fakeBookings:engine.provider.bookingCount(),fakeCRM:engine.provider.crmCount(),auditEntries:engine.store.count('audit'),externalCalls:0},null,2));
}finally{await server.close();engine.close();rmSync(dir,{recursive:true,force:true});}
