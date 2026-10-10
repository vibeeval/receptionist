// Test-only child process. Synthetic credentials and fake provider only.
import { Engine } from '../src/engine.js';
import { fixtureConfig,signed,event,NOW } from './helpers.js';
const [dir,action,json]=process.argv.slice(2);if(!dir||!action)throw new Error('test arguments missing');
const config=fixtureConfig(dir),engine=new Engine(config,{clock:()=>NOW});
if(action==='rollback'){engine.store.transaction(()=>{engine.store.audit('tenant-a','SHOULD_ROLL_BACK','test',NOW);process.exit(74);});}
else if(action==='duplicate'){
 for(let i=0;i<10;i++){const r=await signed(engine,config,'event','demo-a','events',event());if(r.status!==200)throw new Error('unexpected '+r.status);}
 engine.close();
}else if(action==='reserve'){
 const r=await signed(engine,config,'tool','demo-a','bookings',JSON.parse(json!));process.stdout.write(JSON.stringify(r));engine.close();
}else if(action==='drain'){
 await engine.drain();engine.close();
}else if(action==='operator'){
 const input=JSON.parse(json!);engine.close();const operatorEngine=new Engine({...config,maxRequestsPerMinute:2},{clock:()=>NOW});const r=await signed(operatorEngine,config,'operator','demo-a',input.suffix,input.body);process.stdout.write(JSON.stringify(r));operatorEngine.close();
}else if(action==='crash-booking'){
 engine.provider.setFault('booking','crash_after_commit');try{await engine.drain();}catch{process.exit(75);}process.exit(76);
}else throw new Error('Unknown test action');
