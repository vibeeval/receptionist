import { bootstrapAdmin } from './admin/bootstrap.js';
import type { PgStore } from './pg-store.js';
import { Store } from './store.js';
import { compose } from './composition.js';
import { coreFromReferences,environmentSecret,compositionSchema } from './composition-config.js';
import { SqliteAsyncStore } from './async-store.js';
import { Operations,settleWorker,redactedLog } from './operations.js';
import { readFileSync } from 'node:fs';
import { Engine } from './engine.js';
import { loadConfig } from './config.js';
import { startServer } from './server.js';
const path=process.env.CONFIG_JSON_PATH;
if(!path)throw new Error('CONFIG_JSON_PATH_REQUIRED: see docs/quickstart.md');
const port=Number(process.env.PORT??8787);
if(!Number.isInteger(port)||port<0||port>65535)throw new Error('INVALID_PORT');
const sink=(entry:object)=>console.log(JSON.stringify(entry));
const compositionPath=process.env.COMPOSITION_JSON_PATH;
let closeApp:()=>unknown;let providerReady=async()=>true;
let engine:Engine<Store|PgStore>,router:Pick<Engine,'config'|'request'> & {providerMock?:boolean};
if(compositionPath){
 const settings=compositionSchema.safeParse(JSON.parse(readFileSync(compositionPath,'utf8')));
 if(!settings.success||settings.data.profile!=='live'||!settings.data.enableLive)throw new Error('LIVE_MODE_DISABLED');
 const core=coreFromReferences(JSON.parse(readFileSync(path,'utf8')),environmentSecret);
 const app=await compose(core,settings.data,{resolve:environmentSecret});engine=app.engine;router=app.router;closeApp=app.close;providerReady=app.ready;
}else{engine=new Engine(loadConfig(JSON.parse(readFileSync(path,'utf8'))),{log:sink});router=engine;closeApp=()=>engine.close();}
const ops=new Operations(engine.store instanceof Store?new SqliteAsyncStore(engine.store):engine.store,sink,Date.now,engine.providerMock);
const server=await startServer(router,port,{get stopping(){return ops.stopping;},ready:async()=>{const healthy=await ops.ready()&&await providerReady();return healthy&&!ops.stopping&&!ops.workerFailed;}});let active:Promise<unknown>|undefined;
const admin=await bootstrapAdmin(engine,()=>ops.ready());
if(admin)console.log(JSON.stringify({adminUrl:admin.url,scope:'LOCALHOST_ONLY'}));
const timer=setInterval(()=>{if(!active&&!ops.stopping){active=engine.drain().then(()=>ops.alerts()).catch(()=>ops.workerFailure()).finally(()=>{active=undefined;});}},250);
console.log(JSON.stringify({url:server.url,mode:compositionPath?'LIVE_CONFIGURED_UNVALIDATED':'LOCAL_SYNTHETIC_ONLY',providerMock:engine.providerMock}));
async function stop(){if(ops.stopping)return;ops.beginShutdown();clearInterval(timer);await admin?.close();const ingress=server.close().then(()=>true,()=>false);const [httpDrained,workerDrained]=await Promise.all([ingress,settleWorker(active)]);const drained=httpDrained&&workerDrained;if(drained){try{await closeApp();redactedLog(sink,'SHUTDOWN_COMPLETE',{},engine.providerMock);}catch{redactedLog(sink,'SHUTDOWN_TIMEOUT',{},engine.providerMock);process.exitCode=1;process.exit(1);}}else{redactedLog(sink,'SHUTDOWN_TIMEOUT',{},engine.providerMock);process.exitCode=1;process.exit(1);}}
process.once('SIGTERM',()=>{void stop();});process.once('SIGINT',()=>{void stop();});
