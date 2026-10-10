import type { AsyncStore } from '../async-store.js';
import { digest } from '../security.js';
// Immutable initial schema from the independently reviewed provider contract branch.
// A checksum guards code drift; legacy rows are adopted transactionally without replay.
export const retellDDL=[
 'CREATE TABLE IF NOT EXISTS retell_sessions(account TEXT NOT NULL,provider_call TEXT NOT NULL,tenant TEXT NOT NULL,agent TEXT NOT NULL,core_call TEXT NOT NULL,closed INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(account,provider_call))',
 'CREATE TABLE IF NOT EXISTS retell_capabilities(token_hash TEXT PRIMARY KEY,account TEXT NOT NULL,provider_call TEXT NOT NULL,tenant TEXT NOT NULL,core_call TEXT NOT NULL,command_id TEXT NOT NULL,slot_id TEXT NOT NULL,confirmation_id TEXT NOT NULL,expires_ms BIGINT NOT NULL)'
];
export async function migrateRetell(db:AsyncStore){
 await db.transaction(async()=>{
  await db.run('CREATE TABLE IF NOT EXISTS provider_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
  const version='retell-001',checksum=digest(retellDDL.join('\n'));
  const old=await db.one('SELECT checksum FROM provider_migrations WHERE version=?',version);
  if(old&&old.checksum!==checksum)throw new Error('PROVIDER_MIGRATION_CHECKSUM_MISMATCH');
  for(const sql of retellDDL)await db.run(sql);
  // Fail closed on unsupported legacy shape or orphaned/corrupt capability bindings.
  const sessions=await db.all('SELECT account,provider_call,tenant,agent,core_call,closed FROM retell_sessions');
  const providerId=/^[A-Za-z0-9_-]{1,128}$/,coreId=/^[A-Za-z0-9_-]{1,64}$/;
  for(const r of sessions){
   if(!/^[a-z0-9-]{1,32}$/.test(String(r.account))||!providerId.test(String(r.provider_call))||!providerId.test(String(r.agent))||!/^[a-z0-9-]{1,64}$/.test(String(r.tenant))||![0,1].includes(Number(r.closed))||r.core_call!==digest(r.account+':'+r.provider_call)||!await db.one('SELECT tenant FROM controls WHERE tenant=?',r.tenant!))throw new Error('PROVIDER_UPGRADE_BLOCKED');
   if(Number(r.closed)===1)await db.run("INSERT OR IGNORE INTO booking_admission_gates VALUES(?,?,'provider_closed')",r.tenant!,r.core_call!);
  }
  const caps=await db.all('SELECT token_hash,account,provider_call,tenant,core_call,command_id,slot_id,confirmation_id,expires_ms FROM retell_capabilities');
  for(const c of caps){
   const session=await db.one('SELECT tenant,core_call FROM retell_sessions WHERE account=? AND provider_call=?',c.account!,c.provider_call!);
   const confirmation=await db.one('SELECT call_id,slot_id,expires_ms FROM confirmations WHERE tenant=? AND id=?',c.tenant!,c.confirmation_id!);
   if(!session||session.tenant!==c.tenant||session.core_call!==c.core_call||!/^[a-f0-9]{64}$/.test(String(c.token_hash))||['command_id','slot_id','confirmation_id'].some(k=>!coreId.test(String(c[k])))||!Number.isSafeInteger(Number(c.expires_ms))||Number(c.expires_ms)<0||!confirmation||confirmation.call_id!==c.core_call||confirmation.slot_id!==c.slot_id||Number(c.expires_ms)>Number(confirmation.expires_ms))throw new Error('PROVIDER_UPGRADE_BLOCKED');
  }
  if(!old)await db.run('INSERT INTO provider_migrations VALUES(?,?)',version,checksum);
 });
}
