import { mkdtempSync,rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { Engine as CoreEngine,type Result } from '../../src/engine.js';
import { createPostgresEngine } from '../../src/postgres-engine.js';
import { PgStore } from '../../src/pg-store.js';
import type { Config } from '../../src/config.js';
import { signRequest } from '../../src/security.js';
export { NOW,keys,fixtureConfig,event } from '../helpers.js';
import { NOW,fixtureConfig,event } from '../helpers.js';
export type Engine=CoreEngine<PgStore>;
const schemas=new Map<string,string>();
export async function pgEngine(config:Config,options:{clock?:()=>number;log?:(entry:object)=>void}={}):Promise<Engine>{
 const schema=schemas.get(config.dbPath);if(!schema)throw new Error('PG_TEST_SCHEMA_NOT_REGISTERED');
 return createPostgresEngine(config,process.env.POSTGRES_TEST_URL!,schema,options);
}
export async function harness(){const dir=mkdtempSync(join(tmpdir(),'receptionist-pg-')),config=fixtureConfig(dir),schema='phone_test_'+randomBytes(8).toString('hex');schemas.set(config.dbPath,schema);let now=NOW;const logs:object[]=[];const engine=await pgEngine(config,{clock:()=>now,log:r=>logs.push(r)});
 return {dir,config,schema,engine,logs,setNow:(n:number)=>{now=n;},close:async()=>{await engine.close();const pool=new Pool({connectionString:process.env.POSTGRES_TEST_URL});try{await pool.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await pool.end();schemas.delete(config.dbPath);rmSync(dir,{recursive:true,force:true});}}};
}
export async function signed(engine:Engine,config:Config,role:'event'|'tool'|'operator',route:string,suffix:string,body:unknown,options:{timestamp?:number;signature?:string;raw?:string;method?:string}={}):Promise<Result>{const method=options.method??'POST',path=`/v1/tenants/${route}/${suffix}`,raw=options.raw??(body===undefined?'':JSON.stringify(body)),timestamp=String(options.timestamp??Math.floor(NOW/1000));const tenant=config.tenants.find(t=>t.route===route)!;return engine.request({method,path,body:Buffer.from(raw),headers:{'x-timestamp':timestamp,'x-signature':options.signature??signRequest(tenant.keys[role],timestamp,method,path,Buffer.from(raw))}});}
export async function eligible(h:Awaited<ReturnType<typeof harness>>,callId='call-1',route='demo-a'){await signed(h.engine,h.config,'event',route,'events',event('start-'+callId,callId));await h.engine.drain();await signed(h.engine,h.config,'event',route,'events',event('intent-'+callId,callId,'intent.detected',{intent:'booking',confidence:.95}));await h.engine.drain();}
export async function reserve(h:Awaited<ReturnType<typeof harness>>,commandId='cmd-1',callId='call-1',slotId='slot-1',route='demo-a'){const c=await signed(h.engine,h.config,'operator',route,'confirmations',{callId,slotId,attested:true,evidenceId:'synthetic-confirmation'});if(c.status!==201)return c;return signed(h.engine,h.config,'tool',route,'bookings',{commandId,callId,slotId,confirmationId:c.body.confirmationId});}
