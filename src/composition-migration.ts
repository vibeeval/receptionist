import { Store } from './store.js';
import type { AsyncStore } from './async-store.js';
/** New opt-in composition migration; leaves legacy migration checksums untouched. */
export async function compositionMigration(db:AsyncStore,sqlite?:Store){
 if(sqlite&&!sqlite.one("SELECT version FROM local_migrations WHERE version='003-provider-mode'")){
  const sql=String(sqlite.one("SELECT sql FROM sqlite_master WHERE name='commands'")?.sql);
  if(!sql.includes('CHECK(provider_mock=1)'))throw new Error('UNSUPPORTED_COMMAND_SCHEMA');
  sqlite.db.exec('PRAGMA foreign_keys=OFF');
  try{sqlite.transaction(()=>{sqlite.db.exec(sql.replace('CREATE TABLE commands','CREATE TABLE commands_new').replace('CHECK(provider_mock=1)','CHECK(provider_mock IN(0,1))'));sqlite.db.exec('INSERT INTO commands_new SELECT * FROM commands; DROP TABLE commands; ALTER TABLE commands_new RENAME TO commands;');if(sqlite.all('PRAGMA foreign_key_check').length)throw new Error('MIGRATION_FOREIGN_KEY_FAILURE');sqlite.run('INSERT INTO local_migrations VALUES(?,?)','003-provider-mode',Date.now());});}finally{sqlite.db.exec('PRAGMA foreign_keys=ON');}
 }
 await db.transaction(async()=>{
  if(!sqlite&&!await db.one("SELECT version FROM local_migrations WHERE version='003-provider-mode'")){
   await db.run('ALTER TABLE commands DROP CONSTRAINT commands_provider_mock_check');await db.run('ALTER TABLE commands ADD CONSTRAINT commands_provider_mock_check CHECK(provider_mock IN(0,1))');await db.run('INSERT INTO local_migrations VALUES(?,?)','003-provider-mode',Date.now());
  }
  await db.run('CREATE TABLE IF NOT EXISTS composition_profile(id INTEGER PRIMARY KEY,profile TEXT NOT NULL,mapping_hash TEXT NOT NULL)');
  await db.run('CREATE TABLE IF NOT EXISTS voice_confirmations(nonce_hash TEXT PRIMARY KEY,tenant TEXT NOT NULL,account TEXT NOT NULL,provider_call TEXT NOT NULL,core_call TEXT NOT NULL,slot TEXT NOT NULL,slot_hash TEXT NOT NULL,expires_ms BIGINT NOT NULL,state TEXT NOT NULL,provenance TEXT)');
  await db.run('CREATE TABLE IF NOT EXISTS confirmation_slot_bindings(tenant TEXT NOT NULL,confirmation_id TEXT NOT NULL,call_id TEXT NOT NULL,slot_id TEXT NOT NULL,slot_hash TEXT NOT NULL,PRIMARY KEY(tenant,confirmation_id))');
  await db.run('CREATE TABLE IF NOT EXISTS local_followups(tenant TEXT NOT NULL,command_id TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(tenant,command_id))');
 });
}
