import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Engine } from '../src/engine.js';
import { startServer } from '../src/server.js';
import { signRequest } from '../src/security.js';
import { harness,signed,event,eligible,reserve,keys,NOW } from './helpers.js';
function child(dir:string,action:string,input?:object):Promise<{code:number|null;stdout:string;stderr:string}>{return new Promise((resolve,reject)=>{
 const p=spawn(process.execPath,['dist/tests/process-task.js',dir,action,...(input?[JSON.stringify(input)]:[])],{stdio:['ignore','pipe','pipe']});let stdout='',stderr='';p.stdout.on('data',d=>stdout+=d);p.stderr.on('data',d=>stderr+=d);p.on('error',reject);p.on('exit',code=>resolve({code,stdout,stderr}));
});}
test('actual loopback HTTP accepts signed event, rejects unsigned, limits raw body',async()=>{const h=harness();const server=await startServer(h.engine);try{
 assert.equal((await fetch(server.url+'/health')).status,200);
 const path='/v1/tenants/demo-a/events',body=JSON.stringify(event()),ts=String(NOW/1000);
 const response=await fetch(server.url+path,{method:'POST',body,headers:{'content-type':'application/json','x-timestamp':ts,'x-signature':signRequest(keys.event,ts,'POST',path,Buffer.from(body))}});assert.equal(response.status,200);assert.equal((await response.json()as {providerMock:boolean}).providerMock,true);
 assert.equal((await fetch(server.url+path,{method:'POST',body})).status,401);
 assert.equal((await fetch(server.url+path,{method:'POST',body:'x'.repeat(20000)})).status,413);
 await h.engine.drain();assert.equal(h.engine.store.count('calls'),1);
}finally{await server.close();h.close();}});
test('100 events across 10 OS processes produce one inbox/job',async()=>{const h=harness();try{
 const rs=await Promise.all(Array.from({length:10},()=>child(h.dir,'duplicate')));for(const r of rs)assert.equal(r.code,0,r.stderr);
 assert.equal(h.engine.store.count('inbox'),1);assert.equal(h.engine.store.count('jobs'),1);
}finally{h.close();}});
test('self-host entrypoint binds loopback and shuts down cleanly',async()=>{const h=harness();let p:ReturnType<typeof spawn>|undefined;try{
 const configPath=join(h.dir,'synthetic-config.json');writeFileSync(configPath,JSON.stringify(h.config),{mode:0o600});
 p=spawn(process.execPath,['dist/src/serve.js'],{env:{...process.env,CONFIG_JSON_PATH:configPath,PORT:'0'},stdio:['ignore','pipe','pipe']});
 const childProcess=p;
 const url=await new Promise<string>((resolve,reject)=>{let data='';const timer=setTimeout(()=>reject(new Error('startup timeout')),5000);childProcess.stdout!.on('data',d=>{data+=d;const line=data.split('\n')[0];if(line){clearTimeout(timer);resolve(JSON.parse(line).url);}});childProcess.once('error',reject);childProcess.once('exit',code=>{if(code)reject(new Error('serve exit '+code));});});
 assert.ok(url.startsWith('http://127.0.0.1:'));assert.equal((await fetch(url+'/health')).status,200);
 const exit=new Promise<number|null>(resolve=>childProcess.once('exit',resolve));childProcess.kill('SIGTERM');assert.equal(await exit,0);
}finally{p?.kill('SIGTERM');h.close();}});
test('20 competing OS processes reserve exactly one slot',async()=>{const h=harness();try{
 const requests=[];for(let i=0;i<20;i++){const callId='race-'+i;await eligible(h,callId);const c=await signed(h.engine,h.config,'operator','demo-a','confirmations',{callId,slotId:'slot-1',attested:true,evidenceId:'race'});requests.push({commandId:'race-cmd-'+i,callId,slotId:'slot-1',confirmationId:c.body.confirmationId});}
 const rs=await Promise.all(requests.map(r=>child(h.dir,'reserve',r)));for(const r of rs)assert.equal(r.code,0,r.stderr);
 assert.equal(rs.map(r=>JSON.parse(r.stdout).status).filter(x=>x===202).length,1);assert.equal(h.engine.store.count('reservations'),1);await h.engine.drain();assert.equal(h.engine.provider.bookingCount(),1);
}finally{h.close();}});
test('OS termination rolls back open SQL transaction',async()=>{const h=harness();try{
 const r=await child(h.dir,'rollback');assert.equal(r.code,74);assert.equal(h.engine.store.count('audit'),0);
}finally{h.close();}});
test('OS termination after external commit is recovered without a second booking',async()=>{const h=harness();try{
 await eligible(h);await reserve(h);const r=await child(h.dir,'crash-booking');assert.equal(r.code,75,r.stderr);
 const reopened=new Engine(h.config,{clock:()=>NOW+60_000});try{await reopened.drain();assert.equal(reopened.store.command('tenant-a','cmd-1')?.state,'confirmed');assert.equal(reopened.provider.bookingCount(),1);assert.equal(reopened.provider.bookAttempts(),1);}finally{reopened.close();}
}finally{h.close();}});

test('HTTP opt-out ACK gates two independent worker processes',async()=>{const h=harness();const server=await startServer(h.engine);try{
 await eligible(h);await reserve(h);const path='/v1/tenants/demo-a/events',body=JSON.stringify(event('stop-race','call-1','intent.detected',{intent:'opt_out',confidence:1})),ts=String(NOW/1000);
 const ack=await fetch(server.url+path,{method:'POST',body,headers:{'x-timestamp':ts,'x-signature':signRequest(keys.event,ts,'POST',path,Buffer.from(body))}});assert.equal(ack.status,200);
 const rs=await Promise.all([child(h.dir,'drain'),child(h.dir,'drain')]);for(const r of rs)assert.equal(r.code,0,r.stderr);assert.equal(h.engine.provider.bookAttempts(),0);assert.equal(h.engine.store.budget('tenant-a').reserved,0);
}finally{await server.close();h.close();}});
test('saturated tool budget cannot block cross-process kill; replay remains inert after restart',async()=>{const h=harness();const e=new Engine({...h.config,maxRequestsPerMinute:2},{clock:()=>NOW});try{
 const old={suffix:'control',body:{kill:false}};assert.equal(JSON.parse((await child(h.dir,'operator',old)).stdout).status,200);
 for(let i=0;i<3;i++)await signed(e,h.config,'tool','demo-a','knowledge',undefined,{method:'GET'});
 const kills=await Promise.all([child(h.dir,'operator',{suffix:'control',body:{kill:true,operationId:'p1'}}),child(h.dir,'operator',{suffix:'control',body:{kill:true,operationId:'p2'}})]);for(const r of kills){assert.equal(r.code,0,r.stderr);assert.equal(JSON.parse(r.stdout).status,200);}
 assert.equal((await child(h.dir,'operator',old)).code,0);assert.equal(h.engine.store.killed('tenant-a'),true);
}finally{e.close();h.close();}});
