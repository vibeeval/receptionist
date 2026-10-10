import { RetellGateway } from '../../src/providers/retell.js';
import { createHmac } from 'node:crypto';
import { Engine } from '../../src/engine.js';
import { PgStore } from '../../src/pg-store.js';
import { fixtureConfig,event,NOW } from '../helpers.js';
import { signed } from './helpers.js';
const [dir,schema,action,json]=process.argv.slice(2);if(!dir||!schema||!action)throw new Error('TEST_ARGUMENTS_REQUIRED');
const config=fixtureConfig(dir),store=await PgStore.open(config,process.env.POSTGRES_TEST_URL!,schema),engine=new Engine(config,{store,clock:()=>NOW});
if(action==='provider-duplicate'){
 const key='synthetic-retell-account-a-key-only-12345';
 const gateway=await RetellGateway.open(engine,store,[{id:'account-a',key,tenantRoute:'demo-a',agentIds:['agent-a']}],()=>NOW);
 for(let i=0;i<10;i++){const body=Buffer.from(JSON.stringify({event:'call_started',call:{call_id:'multiprocess-call',agent_id:'agent-a',start_timestamp:NOW}})),at=Date.now();
 const r=await gateway.handle({method:'POST',path:'/providers/retell/account-a/events',body,headers:{'x-retell-signature':`v=${at},d=${createHmac('sha256',key).update(body.toString()+at).digest('hex')}`}});if(r.status!==200)throw new Error('PROVIDER_DUPLICATE_FAILED');}
}
else if(action==='duplicate'){for(let i=0;i<10;i++){const r=await signed(engine,config,'event','demo-a','events',event());if(r.status!==200)throw new Error('DUPLICATE_FAILED');}}
else if(action==='reserve'){process.stdout.write(JSON.stringify(await signed(engine,config,'tool','demo-a','bookings',JSON.parse(json!))));}
else if(action==='rollback'){await store.transaction(async()=>{await store.audit('tenant-a','ROLLBACK_PROBE','synthetic',NOW);process.exit(74);});}
else if(action==='crash-booking'){engine.provider.setFault('booking','crash_after_commit');try{await engine.drain();}catch{process.exit(75);}process.exit(76);}
else if(action==='drain')await engine.drain();
else throw new Error('TEST_ACTION_REQUIRED');
await engine.close();
