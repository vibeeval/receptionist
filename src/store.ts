import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { mkdirSync, chmodSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.js';
import { eventSchema } from './contracts.js';
import { digest } from './security.js';
export type Row=Record<string,string|number|null>;
export interface Command extends Row {tenant:string;id:string;call_id:string;slot_id:string;confirmation_id:string;state:string;hash:string;cost:number;provider_receipt:string|null;provider_mock:number;}
export interface Job extends Row {id:number;tenant:string;kind:string;ref:string;attempts:number;lease_token:string;}
export class Store {
 readonly db:DatabaseSync;
 constructor(readonly config:Config,options:{seedDemo?:boolean;deferTenantProvisioning?:boolean}={}){
  mkdirSync(dirname(config.dbPath),{recursive:true,mode:0o700});this.db=new DatabaseSync(config.dbPath);chmodSync(config.dbPath,0o600);
  this.db.exec('PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;');
  this.db.exec(readFileSync(new URL('../../db/sqlite.sql',import.meta.url),'utf8'));
  try{this.transaction(()=>{if(!options.deferTenantProvisioning)this.provisionTenants(options.seedDemo===true);this.backfillCancellationGates();});}catch(e){this.db.close();throw e;}
 }
 provisionTenants(seedDemo=false){const fresh=!this.one('SELECT tenant FROM controls LIMIT 1');for(const t of this.config.tenants){
   this.run('INSERT OR IGNORE INTO controls(tenant) VALUES(?)',t.id);
   this.run('INSERT OR IGNORE INTO budgets(tenant,cap) VALUES(?,?)',t.id,t.budgetMicros);
   this.run('UPDATE budgets SET cap=? WHERE tenant=?',t.budgetMicros,t.id);
   if(seedDemo&&fresh)for(const [id,start,end]of [['slot-1',10,11],['slot-2',11,12],['slot-overlap',10.5,11.5]]as const)
    this.run('INSERT OR IGNORE INTO slots VALUES(?,?,?,?,?,?)',t.id,id,'synthetic-resource',Date.parse('2026-10-10T00:00:00Z')+start*3600000,Date.parse('2026-10-10T00:00:00Z')+end*3600000,'fictional-information-session');
  }
 }
 private backfillCancellationGates(){
  if(this.one('SELECT version FROM local_migrations WHERE version=?','002-cancellation-backfill'))return;
  for(const row of this.all('SELECT tenant,id,safe_payload FROM inbox')){
   let decoded:unknown;try{decoded=JSON.parse(String(row.safe_payload));}catch{throw new Error('UPGRADE_BLOCKED: invalid legacy inbox');}
   const parsed=eventSchema.safeParse(decoded);if(!parsed.success)throw new Error('UPGRADE_BLOCKED: unsupported legacy inbox');
   const event=parsed.data;if(event.type==='intent.detected'&&(['opt_out','human','emergency','transfer'].includes(event.data.intent)||event.data.confidence<this.config.threshold)){
    const inserted=this.run('INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,?)',row.tenant!,event.callId,event.data.intent);
    if(inserted.changes)this.audit(String(row.tenant),'UPGRADE_CANCELLATION_BACKFILLED',event.callId,Date.now());
   }
  }
  for(const call of this.all("SELECT tenant,id,state FROM calls WHERE state IN('human','opted_out')")){
   const inserted=this.run('INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,?)',call.tenant!,call.id!,call.state!);
   if(inserted.changes)this.audit(String(call.tenant),'UPGRADE_CANCELLATION_BACKFILLED',String(call.id),Date.now());
  }
  this.run('INSERT INTO local_migrations VALUES(?,?)','002-cancellation-backfill',Date.now());
 }
 run(sql:string,...params:SQLInputValue[]){return this.db.prepare(sql).run(...params);}
 one<T extends Row=Row>(sql:string,...params:SQLInputValue[]):T|undefined{return this.db.prepare(sql).get(...params)as T|undefined;}
 all<T extends Row=Row>(sql:string,...params:SQLInputValue[]):T[]{return this.db.prepare(sql).all(...params)as T[];}
 transaction<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE');try{const result=fn();this.db.exec('COMMIT');return result;}catch(e){this.db.exec('ROLLBACK');throw e;}}
 audit(tenant:string,action:string,ref:string,now:number){this.run('INSERT INTO audit(tenant,action,ref_hash,at_ms) VALUES(?,?,?,?)',tenant,action,digest(ref),now);}
 enqueue(tenant:string,kind:string,ref:string,now:number){this.run('INSERT OR IGNORE INTO jobs(tenant,kind,ref,due_ms) VALUES(?,?,?,?)',tenant,kind,ref,now);}
 command(tenant:string,id:string){return this.one<Command>('SELECT * FROM commands WHERE tenant=? AND id=?',tenant,id);}
 call(tenant:string,id:string){return this.one('SELECT * FROM calls WHERE tenant=? AND id=?',tenant,id);}
 killed(tenant:string){return this.one('SELECT kill FROM controls WHERE tenant=?',tenant)?.kill===1;}
 budget(tenant:string){return this.one('SELECT * FROM budgets WHERE tenant=?',tenant)as Row&{cap:number;reserved:number;spent:number};}
 setBudgetForTest(tenant:string,cap:number){this.run('UPDATE budgets SET cap=? WHERE tenant=?',cap,tenant);}
 count(table:string){if(!['inbox','jobs','calls','commands','reservations','audit','dlq','slots','human_tasks','confirmations'].includes(table))throw new Error('Invalid table');return Number(this.one('SELECT count(*) AS n FROM '+table)?.n);}
 snapshot(){return {inbox:this.all('SELECT * FROM inbox'),audit:this.all('SELECT * FROM audit'),calls:this.all('SELECT * FROM calls')};}
 claim(now:number):Job|undefined{return this.transaction(()=>{
  // Only expired leases can be recovered; another active process retains ownership.
  for(const job of this.all<Job>("SELECT * FROM jobs WHERE state='leased' AND lease_until<=?",now)){
   if(job.kind==='booking')this.run("UPDATE commands SET state='unknown' WHERE tenant=? AND id=? AND state='attempted'",job.tenant,job.ref);
   this.run("UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL WHERE id=?",job.id);
   this.audit(job.tenant,'LEASE_RECOVERED',job.ref,now);
  }
  const job=this.one<Job>(`SELECT j.* FROM jobs j JOIN controls c ON c.tenant=j.tenant
    WHERE j.state='pending' AND j.due_ms<=? AND (c.kill=0 OR j.kind!='booking' OR EXISTS(SELECT 1 FROM commands b WHERE b.tenant=j.tenant AND b.id=j.ref AND b.state='unknown')) ORDER BY j.id LIMIT 1`,now);
  if(!job)return undefined;
  const token=randomUUID();this.run("UPDATE jobs SET state='leased',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=?",now+this.config.leaseMs,token,job.id);
  return {...job,lease_token:token,attempts:job.attempts+1};
 });}
 owns(job:Job){return !!this.one("SELECT id FROM jobs WHERE id=? AND state='leased' AND lease_token=?",job.id,job.lease_token);}
 done(job:Job){this.run("UPDATE jobs SET state='done',lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?",job.id,job.lease_token);}
 close(){this.db.close();}
}
