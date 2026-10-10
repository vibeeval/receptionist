import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Engine } from '../src/engine.js';
import { loadConfig } from '../src/config.js';
import { signRequest } from '../src/security.js';
import { SqliteAsyncStore } from '../src/async-store.js';
import { startAdmin } from '../src/admin/server.js';
import { AdminState } from '../src/admin/state.js';
import { passwordHash } from '../src/admin/auth.js';
const dir=mkdtempSync(join(tmpdir(),'receptionist-dashboard-demo-'));
const keys={event:randomBytes(32).toString('hex'),tool:randomBytes(32).toString('hex'),operator:randomBytes(32).toString('hex')};
const engine=new Engine(loadConfig({mode:'local',host:'127.0.0.1',dbPath:join(dir,'core.sqlite'),providerDbPath:join(dir,'fake.sqlite'),tenants:[{id:'ornek-atolye',route:'demo',keys,budgetMicros:100000,maxCalls:100}]}));
const db=new SqliteAsyncStore(engine.store),state=new AdminState(join(dir,'admin.sqlite'),randomBytes(32));
const now=Date.now();engine.store.run('INSERT INTO slots VALUES(?,?,?,?,?,?)','ornek-atolye','demo-slot','oda-1',now+86400000,now+88200000,'Örnek danışma');
async function send(role:keyof typeof keys,suffix:string,payload:unknown){const path='/v1/tenants/demo/'+suffix,body=Buffer.from(JSON.stringify(payload)),ts=String(Math.floor(Date.now()/1000));const r=await engine.request({method:'POST',path,body,headers:{'x-timestamp':ts,'x-signature':signRequest(keys[role],ts,'POST',path,body)}});if(r.status>=400)throw new Error('DEMO_SETUP_FAILED');return r.body;}
await send('event','events',{id:'demo-start',callId:'demo-call',type:'call.started',occurredAt:new Date(now).toISOString(),data:{}});await engine.drain();
await send('event','events',{id:'demo-intent',callId:'demo-call',type:'intent.detected',occurredAt:new Date(now).toISOString(),data:{intent:'booking',confidence:.99}});await engine.drain();
const c=await send('operator','confirmations',{callId:'demo-call',slotId:'demo-slot',attested:true,evidenceId:'demo-evidence'});
await send('tool','bookings',{commandId:'demo-booking',callId:'demo-call',slotId:'demo-slot',confirmationId:c.confirmationId});await engine.drain();
const users=await Promise.all((['admin','operator','viewer'] as const).map(async role=>({username:role,passwordHash:await passwordHash('demo-local-only-2026'),tenants:{'ornek-atolye':role}})));
const app=await startAdmin({engine,db,state,users,port:Number(process.env.ADMIN_PORT??8788),demo:true,ready:async()=>true});
console.log(JSON.stringify({dashboard:app.url,mode:'SYNTHETIC_DEMO',username:'admin',password:'demo-local-only-2026',note:'Public dummy credentials; temporary local data. No provider requests.'}));
let stopping=false;async function stop(){if(stopping)return;stopping=true;await app.close();state.close();engine.close();rmSync(dir,{recursive:true,force:true});}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
