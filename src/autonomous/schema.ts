import type { AsyncStore } from '../async-store.js';
import { digest } from '../security.js';
const statements=[
  "CREATE TABLE IF NOT EXISTS monitor_sessions(account TEXT NOT NULL,call_id TEXT NOT NULL,epoch BIGINT NOT NULL,status TEXT NOT NULL,max_ms BIGINT NOT NULL DEFAULT 0,PRIMARY KEY(account,call_id))",
  "CREATE TABLE IF NOT EXISTS monitor_items(account TEXT NOT NULL,call_id TEXT NOT NULL,item_id TEXT NOT NULL,hash TEXT NOT NULL,role TEXT NOT NULL,at_ms BIGINT NOT NULL,PRIMARY KEY(account,call_id,item_id))",
  "CREATE TABLE IF NOT EXISTS monitor_tool_links(account TEXT NOT NULL,call_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,slot_id TEXT NOT NULL,epoch BIGINT NOT NULL,at_ms BIGINT NOT NULL,PRIMARY KEY(account,call_id,tool_call_id))",
  "CREATE TABLE IF NOT EXISTS auto_proposals(id TEXT PRIMARY KEY,nonce TEXT NOT NULL,revision BIGINT NOT NULL,tenant TEXT NOT NULL,account TEXT NOT NULL,call_id TEXT NOT NULL,core_call TEXT NOT NULL,slot_id TEXT NOT NULL,slot_hash TEXT NOT NULL,slot_snapshot TEXT NOT NULL,time_zone TEXT NOT NULL,readback TEXT NOT NULL,epoch BIGINT NOT NULL,floor_ms BIGINT NOT NULL,created_ms BIGINT NOT NULL,expires_ms BIGINT NOT NULL,state TEXT NOT NULL,marker_ms BIGINT,readback_item TEXT,readback_ok BIGINT NOT NULL DEFAULT 0,window_ms BIGINT,dtmf_item TEXT,confirmation_id TEXT NOT NULL,command_id TEXT NOT NULL,reason TEXT,UNIQUE(account,call_id,revision))"
];
export async function migrateAutonomous(db:AsyncStore){await db.transaction(async()=>{
 await db.run('CREATE TABLE IF NOT EXISTS autonomous_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
 const checksum=digest(statements.join('\n'));const old=await db.one("SELECT checksum FROM autonomous_migrations WHERE version='001'");
 if(old&&old.checksum!==checksum)throw new Error('AUTONOMOUS_MIGRATION_MISMATCH');
 for(const sql of statements)await db.run(sql);
 if(!old)await db.run('INSERT INTO autonomous_migrations VALUES(?,?)','001',checksum);
 const timingSql='CREATE TABLE IF NOT EXISTS auto_timing(proposal_id TEXT PRIMARY KEY REFERENCES auto_proposals(id),marker_item TEXT NOT NULL,entry_item TEXT,entry_ms BIGINT,agent_ms BIGINT,agent_chars BIGINT,window_item TEXT,last_transition_ms BIGINT,dtmf_ms BIGINT,authorized_after_ms BIGINT)';
 const edgeSql='CREATE TABLE IF NOT EXISTS auto_time_edges(proposal_id TEXT NOT NULL REFERENCES auto_proposals(id),item_id TEXT NOT NULL,PRIMARY KEY(proposal_id,item_id))';
 const timingChecksum=digest(timingSql+'\n'+edgeSql),timingVersion=await db.one("SELECT checksum FROM autonomous_migrations WHERE version='002-time-order'");
 if(timingVersion&&timingVersion.checksum!==timingChecksum)throw new Error('AUTONOMOUS_MIGRATION_MISMATCH');
 await db.run(timingSql);await db.run(edgeSql);
 if(!timingVersion)await db.run('INSERT INTO autonomous_migrations VALUES(?,?)','002-time-order',timingChecksum);
 const proofStatements=[
  'CREATE TABLE IF NOT EXISTS auto_invocations(account TEXT NOT NULL,call_id TEXT NOT NULL,tool_call_id TEXT NOT NULL,item_id TEXT NOT NULL,hash TEXT NOT NULL,slot_id TEXT NOT NULL,epoch BIGINT NOT NULL,at_ms BIGINT NOT NULL,valid BIGINT NOT NULL,proposal_id TEXT,PRIMARY KEY(account,call_id,tool_call_id))',
  'CREATE TABLE IF NOT EXISTS auto_tool_proof(proposal_id TEXT PRIMARY KEY REFERENCES auto_proposals(id),account TEXT NOT NULL,call_id TEXT NOT NULL,epoch BIGINT NOT NULL,invocation_item TEXT NOT NULL,invocation_hash TEXT NOT NULL,result_item TEXT NOT NULL,result_hash TEXT NOT NULL,UNIQUE(account,call_id,invocation_item),UNIQUE(account,call_id,result_item))'
 ];
 const proofChecksum=digest(proofStatements.join('\n')),proofVersion=await db.one("SELECT checksum FROM autonomous_migrations WHERE version='003-tool-proof'");
 if(proofVersion&&proofVersion.checksum!==proofChecksum)throw new Error('AUTONOMOUS_MIGRATION_MISMATCH');
 for(const sql of proofStatements)await db.run(sql);
 if(!proofVersion)await db.run('INSERT INTO autonomous_migrations VALUES(?,?)','003-tool-proof',proofChecksum);

 });}
