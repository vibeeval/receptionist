import type { AsyncStore } from './async-store.js';
import { digest } from './security.js';
export const retentionPolicy=Object.freeze({version:'synthetic-v1',inboxPayloadTtlMs:86400000,capabilityGraceMs:300000,maxClockSkewMs:30000,maxStepMs:3600000});
/** Test-fixture provisioning only; never called by server or automatically at startup. */
export async function initializeSyntheticRetention(db:AsyncStore,fixtureToken:string,now:number){
 if(!/^[a-f0-9]{64}$/.test(fixtureToken)||!Number.isSafeInteger(now)||now<0)throw new Error('SYNTHETIC_FIXTURE_REQUIRED');
 await db.transaction(async()=>{
  for(const table of ['inbox','calls','commands','retell_sessions','retell_capabilities'])if((await db.all('SELECT * FROM '+table)).length)throw new Error('EMPTY_SYNTHETIC_FIXTURE_REQUIRED');
  await db.run('CREATE TABLE IF NOT EXISTS synthetic_retention_guard(id INTEGER PRIMARY KEY,token_hash TEXT NOT NULL,last_ms BIGINT NOT NULL,policy TEXT NOT NULL)');
  if(await db.one('SELECT * FROM synthetic_retention_guard'))throw new Error('FIXTURE_ALREADY_INITIALIZED');
  await db.run('INSERT INTO synthetic_retention_guard VALUES(1,?,?,?)',digest(fixtureToken),now,retentionPolicy.version);
 });
}
export async function retentionRun(db:AsyncStore,options:{fixtureToken:string;now:number;referenceNow:number;apply?:boolean}){
 return db.transaction(async()=>{
  const guard=await db.one('SELECT * FROM synthetic_retention_guard WHERE id=1');
  if(!guard||guard.token_hash!==digest(options.fixtureToken)||guard.policy!==retentionPolicy.version)throw new Error('SYNTHETIC_FIXTURE_REQUIRED');
  const {now,referenceNow}=options;
  if(!Number.isSafeInteger(now)||!Number.isSafeInteger(referenceNow)||now<Number(guard.last_ms)||now-Number(guard.last_ms)>retentionPolicy.maxStepMs||Math.abs(now-referenceNow)>retentionPolicy.maxClockSkewMs)throw new Error('RETENTION_CLOCK_UNSAFE');
  // Preserve all identifiers, hashes, commands, cancellation gates, jobs and audit tombstones.
  // Only completed payloads and expired capabilities of terminal calls are eligible.
  const safeCall=async(tenant:string,call:string)=>{
   const c=await db.call(tenant,call);if(!c||!['ended','opted_out'].includes(String(c.state)))return false;
   if(await db.one("SELECT id FROM commands WHERE tenant=? AND call_id=? AND state IN('pending','attempted','unknown')",tenant,call))return false;
   if(await db.one("SELECT id FROM jobs WHERE tenant=? AND state!='done' AND (kind='event' OR ref IN(SELECT id FROM commands WHERE tenant=? AND call_id=?))",tenant,tenant,call))return false;
   return true;
  };
  let payloads=0,capabilities=0,protectedRows=0;
  for(const row of await db.all("SELECT * FROM inbox WHERE created_ms<? AND safe_payload!='{}'",now-retentionPolicy.inboxPayloadTtlMs)){
   let call:unknown;try{call=JSON.parse(String(row.safe_payload)).callId;}catch{protectedRows++;continue;}
   if(typeof call!=='string'||!await safeCall(String(row.tenant),call)){protectedRows++;continue;}
   const job=await db.one("SELECT state FROM jobs WHERE tenant=? AND kind='event' AND ref=?",row.tenant!,row.id!);
   if(job?.state!=='done'){protectedRows++;continue;}
   payloads++;if(options.apply)await db.run("UPDATE inbox SET safe_payload='{}' WHERE tenant=? AND id=?",row.tenant!,row.id!);
  }
  for(const row of await db.all('SELECT * FROM retell_capabilities WHERE expires_ms<?',now-retentionPolicy.capabilityGraceMs)){
   if(!await safeCall(String(row.tenant),String(row.core_call))){protectedRows++;continue;}
   capabilities++;if(options.apply)await db.run('DELETE FROM retell_capabilities WHERE token_hash=?',row.token_hash!);
  }
  if(options.apply)await db.run('UPDATE synthetic_retention_guard SET last_ms=? WHERE id=1',now);
  return {policy:retentionPolicy.version,mode:options.apply?'synthetic-apply':'dry-run',payloads,capabilities,protectedRows,tombstonesDeleted:0,providerMock:true};
 });
}
