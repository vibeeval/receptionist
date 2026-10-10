import type { MonitorTransport } from '../../src/autonomous/transport.js';
import { FLOW_DIGEST } from '../../src/autonomous/flow.js';
import { createServer } from 'node:http';
import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHmac } from 'node:crypto';
import { compose } from '../../src/composition.js';
import { fixtureConfig } from '../helpers.js';
import { Operations } from '../../src/operations.js';
import { startServer } from '../../src/server.js';
import { signRequest } from '../../src/security.js';
export async function fixture(profile:'test'|'live'='test',monitorTransport?:MonitorTransport,database?:{kind:'postgres';urlRef:string;schema:string;mode:'local-test'}){
 const dir=mkdtempSync(join(tmpdir(),'composition-synthetic-')),config=fixtureConfig(dir);let now=Date.now();
 const key='synthetic-retell-account-key-1234567890',tokens={retell:key,google:'synthetic-google-token-not-real'};
 const events=new Map<string,object>();let posts=0,gets=0,mode='normal';
 const fake=createServer(async(req,res)=>{const chunks=[];for await(const x of req)chunks.push(x);if(req.headers.authorization!=='Bearer '+tokens.google){res.statusCode=401;res.end('{}');return;}
  if(req.method==='POST'){posts++;if(mode==='429'){res.statusCode=429;res.end('{}');return;}const input=JSON.parse(Buffer.concat(chunks).toString());const receipt={...input,status:'confirmed'};events.set(input.id,receipt);if(mode==='after_commit_timeout'){res.destroy();return;}res.statusCode=201;res.end(JSON.stringify(receipt));}
  else{gets++;const id=req.url?.split('/').pop()!,old=events.get(id);res.statusCode=old?200:404;res.end(JSON.stringify(old??{}));}
 });await new Promise<void>(r=>fake.listen(0,'127.0.0.1',r));const address=fake.address();if(!address||typeof address==='string')throw new Error('TEST_BIND_FAILED');const origin='http://127.0.0.1:'+address.port;
 const settings={...(database?{database}:{}),...(monitorTransport?{autonomous:{pins:Object.fromEntries(['agent-a','agent-b'].map(id=>[id,{agentVersion:1,flowId:'synthetic-flow',flowVersion:1,artifactSha256:FLOW_DIGEST}]))}}:{}),profile,enableLive:profile==='live',accounts:[{id:'account-a',keyRef:'env:RETELL_TEST_KEY',tenantRoute:'demo-a',agentIds:['agent-a']},{id:'account-b',keyRef:'env:RETELL_TEST_KEY_B',tenantRoute:'demo-b',agentIds:['agent-b']}],google:{accessTokenRef:'env:GOOGLE_TEST_TOKEN',scope:'https://www.googleapis.com/auth/calendar.events.owned',calendars:{'tenant-a':'synthetic-a','tenant-b':'synthetic-b'}},knowledge:{'tenant-a':{name:'Test A',policy:'Belirsizlikte insana yönlendir.',service:'Test görüşmesi'},'tenant-b':{name:'Test B',policy:'Belirsizlikte insana yönlendir.',service:'Test görüşmesi'}},slots:config.tenants.map(t=>({tenant:t.id,id:'slot-future',resource:'test-resource',startMs:now+86400000,endMs:now+90000000,service:'test-session'}))};
 const resolve=(ref:string)=>ref==='env:POSTGRES_TEST_URL'?process.env.POSTGRES_TEST_URL!:ref==='env:GOOGLE_TEST_TOKEN'?tokens.google:ref==='env:RETELL_TEST_KEY_B'?key+'b':key;
 const fetcher:typeof fetch=async(input,init)=>{const u=new URL(String(input));if(u.origin!=='https://www.googleapis.com')throw new Error('UNEXPECTED_PRODUCTION_TARGET');return fetch(origin+u.pathname+u.search,init);};
 const app=await compose(config,settings,{resolve,fetcher,clock:()=>now,...(monitorTransport?{monitorTransport}:{})});const server=await startServer(app.router,0,new Operations(app.db,()=>{},()=>now,app.engine.providerMock));
 async function retell(kind:string,input:unknown,signingKey=key){const body=JSON.stringify(input),at=Date.now(),response=await fetch(server.url+'/providers/retell/account-a/'+kind,{method:'POST',body,headers:{'x-retell-signature':`v=${at},d=${createHmac('sha256',signingKey).update(body+at).digest('hex')}`}});return {status:response.status,body:await response.json() as Record<string,unknown>};}
 async function operator(action:string,input:unknown,role:'operator'|'tool'='operator'){const path='/v1/tenants/demo-a/voice-confirmations/'+action,body=JSON.stringify(input),ts=String(Math.floor(now/1000)),r=await fetch(server.url+path,{method:'POST',body,headers:{'x-timestamp':ts,'x-signature':signRequest(config.tenants[0]!.keys[role],ts,'POST',path,Buffer.from(body))}});return {status:r.status,body:await r.json() as Record<string,unknown>};}
 const call={call_id:'provider-call',agent_id:'agent-a',agent_version:1,start_timestamp:now};
 const proposal={account:'account-a',providerCall:call.call_id,slotId:'slot-future',intent:'booking'};
 async function prepare(){const started=await retell('events',{event:'call_started',call});if(started.status!==200)throw new Error('START_FAILED');await app.engine.drain();const c=await operator('challenge',proposal);if(c.status!==201)throw new Error('CHALLENGE_FAILED_'+c.body.code);const a=await operator('attest',{...proposal,nonce:c.body.nonce,userConfirmed:true,provenance:'human_operator',evidenceId:'synthetic-human-observation'});if(a.status!==201)throw new Error('ATTEST_FAILED_'+a.body.code);return a.body;}
 return {dir,config,app,settings,resolve,fetcher,server,call,proposal,operator,retell,prepare,events,stats:()=>({posts,gets}),setMode:(m:string)=>{mode=m;},advance:(ms:number)=>{now+=ms;},close:async()=>{await server.close();await app.close();await new Promise<void>((r,j)=>fake.close(e=>e?j(e):r()));rmSync(dir,{recursive:true,force:true});}};
}
