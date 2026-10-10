import { AsyncLocalStorage } from 'node:async_hooks';
import { Pool,type PoolClient } from 'pg';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { SQLInputValue } from 'node:sqlite';
import type { Config } from './config.js';
import type { AsyncStore } from './async-store.js';
import type { Row,Command,Job } from './store.js';
import { eventSchema } from './contracts.js';
import { digest } from './security.js';
/** Local single-instance adapter. Transactions serialize per schema, across OS processes.
 * No network/provider side effects are allowed inside transaction callbacks. */
export class PgStore implements AsyncStore {
 private context=new AsyncLocalStorage<PoolClient>();
 private pool:Pool;
 private closed=false;
 private constructor(readonly config:Config,connectionString:string,readonly schema:string,production=false){
  const url=new URL(connectionString);
  if(production){if(url.protocol!=='postgresql:'||!url.hostname||!url.username||!url.password||url.search||url.hash||!/^receptionist_[a-z0-9_]{1,40}$/.test(schema))throw new Error('INVALID_PRODUCTION_DATABASE_CONFIG');}
  else if(url.protocol!=='postgresql:'||!['127.0.0.1','localhost','[::1]'].includes(url.hostname)||!url.pathname.endsWith('_test')||url.search||!/^phone_test_[a-z0-9_]{1,50}$/.test(schema))throw new Error('LOCAL_TEST_DATABASE_REQUIRED');
  this.pool=new Pool({connectionString,...(production?{ssl:{rejectUnauthorized:true}}:{}),max:20,connectionTimeoutMillis:5000,idleTimeoutMillis:1000,statement_timeout:10000,lock_timeout:5000});
  this.pool.on('error',()=>{}); // query failures still reject; never log connection secrets
 }
 static async open(config:Config,url:string,schema:string,mode:'local-test'|'production'='local-test',options:{seedDemo?:boolean;deferTenantProvisioning?:boolean}={}):Promise<PgStore>{
  const store=new PgStore(config,url,schema,mode==='production');
  try{await store.transaction(async()=>{
   await store.run('CREATE SCHEMA IF NOT EXISTS "'+schema+'"');
   await store.run('CREATE TABLE IF NOT EXISTS schema_migrations(version TEXT PRIMARY KEY,checksum TEXT NOT NULL)');
   const sql=readFileSync(new URL('../../db/postgres-store.sql',import.meta.url),'utf8'),hash=digest(sql);
   const existing=await store.one('SELECT checksum FROM schema_migrations WHERE version=?','001');
   if(existing&&existing.checksum!==hash)throw new Error('MIGRATION_CHECKSUM_MISMATCH');
   if(!existing){await store.raw(sql);await store.run('INSERT INTO schema_migrations VALUES(?,?)','001',hash);}
   if(!options.deferTenantProvisioning)await store.provisionTenants(mode==='local-test'&&options.seedDemo===true);
   await store.run('CREATE TABLE IF NOT EXISTS booking_admission_gates(tenant TEXT NOT NULL,call_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(tenant,call_id))');
   await store.backfillCancellationGates();
  });return store;}catch(e){await store.close();throw e;}
 }
 async provisionTenants(seedDemo=false){const fresh=!await this.one('SELECT tenant FROM controls LIMIT 1');
   for(const tenant of this.config.tenants){
    await this.run('INSERT OR IGNORE INTO controls(tenant) VALUES(?)',tenant.id);
    await this.run('INSERT OR IGNORE INTO budgets(tenant,cap) VALUES(?,?)',tenant.id,tenant.budgetMicros);
    await this.run('UPDATE budgets SET cap=? WHERE tenant=?',tenant.budgetMicros,tenant.id);
    if(seedDemo&&fresh)for(const [id,start,end]of [['slot-1',10,11],['slot-2',11,12],['slot-overlap',10.5,11.5]] as const)
     await this.run('INSERT OR IGNORE INTO slots VALUES(?,?,?,?,?,?)',tenant.id,id,'synthetic-resource',Date.parse('2026-10-10T00:00:00Z')+start*3600000,Date.parse('2026-10-10T00:00:00Z')+end*3600000,'fictional-information-session');
   }
 }
 private async client<T>(fn:(client:PoolClient)=>Promise<T>):Promise<T>{
  const current=this.context.getStore();if(current)return fn(current);
  const client=await this.pool.connect();try{await client.query('SET search_path TO "'+this.schema+'",pg_catalog');return await fn(client);}finally{client.release();}
 }
 async transaction<T>(fn:()=>Promise<T>):Promise<T>{
  if(this.context.getStore())throw new Error('NESTED_TRANSACTION_NOT_SUPPORTED');
  return this.client(async client=>{await client.query('BEGIN');try{
   await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[BigInt('0x'+digest(this.schema).slice(0,15)).toString()]);
   const result=await this.context.run(client,fn);await client.query('COMMIT');return result;
  }catch(e){await client.query('ROLLBACK');throw e;}});
 }
 private sql(input:string){let i=0;let sql=input.replace(/\?/g,()=>'$'+(++i)).replace(/\bwindow\b/g,'"window"');if(sql.includes('INSERT OR IGNORE'))sql=sql.replace('INSERT OR IGNORE','INSERT')+' ON CONFLICT DO NOTHING';return sql;}
 private raw(sql:string){return this.client(c=>c.query(sql));}
 async run(sql:string,...p:SQLInputValue[]){return this.client(c=>c.query(this.sql(sql),p));}
 async all<T extends Row=Row>(sql:string,...p:SQLInputValue[]):Promise<T[]>{
  const result=await this.run(sql,...p);return result.rows.map(row=>{for(const f of result.fields)if(f.dataTypeID===20&&row[f.name]!==null){const n=Number(row[f.name]);if(!Number.isSafeInteger(n))throw new Error('UNSAFE_DATABASE_INTEGER');row[f.name]=n;}return row as T;});
 }
 async one<T extends Row=Row>(sql:string,...p:SQLInputValue[]):Promise<T|undefined>{return (await this.all<T>(sql,...p))[0];}
 async close(){if(!this.closed){this.closed=true;await this.pool.end();}}
async backfillCancellationGates() {
    if (await this.one('SELECT version FROM local_migrations WHERE version=?', '002-cancellation-backfill'))
        return;
    for (const row of await this.all('SELECT tenant,id,safe_payload FROM inbox')) {
        let decoded: unknown;
        try {
            decoded = JSON.parse(String(row.safe_payload));
        }
        catch {
            throw new Error('UPGRADE_BLOCKED: invalid legacy inbox');
        }
        const parsed = eventSchema.safeParse(decoded);
        if (!parsed.success)
            throw new Error('UPGRADE_BLOCKED: unsupported legacy inbox');
        const event = parsed.data;
        if (event.type === 'intent.detected' && (['opt_out', 'human', 'emergency', 'transfer'].includes(event.data.intent) || event.data.confidence < this.config.threshold)) {
            const inserted = await this.run('INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,?)', row.tenant!, event.callId, event.data.intent);
            if (inserted.rowCount)
                await this.audit(String(row.tenant), 'UPGRADE_CANCELLATION_BACKFILLED', event.callId, Date.now());
        }
    }
    for (const call of await this.all("SELECT tenant,id,state FROM calls WHERE state IN('human','opted_out')")) {
        const inserted = await this.run('INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,?)', call.tenant!, call.id!, call.state!);
        if (inserted.rowCount)
            await this.audit(String(call.tenant), 'UPGRADE_CANCELLATION_BACKFILLED', String(call.id), Date.now());
    }
    await this.run('INSERT INTO local_migrations VALUES(?,?)', '002-cancellation-backfill', Date.now());
}
async audit(tenant: string, action: string, ref: string, now: number) { await this.run('INSERT INTO audit(tenant,action,ref_hash,at_ms) VALUES(?,?,?,?)', tenant, action, digest(ref), now); }
async enqueue(tenant: string, kind: string, ref: string, now: number) { await this.run('INSERT OR IGNORE INTO jobs(tenant,kind,ref,due_ms) VALUES(?,?,?,?)', tenant, kind, ref, now); }
async command(tenant: string, id: string) { return await this.one<Command>('SELECT * FROM commands WHERE tenant=? AND id=?', tenant, id); }
async call(tenant: string, id: string) { return await this.one('SELECT * FROM calls WHERE tenant=? AND id=?', tenant, id); }
async killed(tenant: string) { return (await this.one('SELECT kill FROM controls WHERE tenant=?', tenant))?.kill === 1; }
async budget(tenant: string) { return await this.one('SELECT * FROM budgets WHERE tenant=?', tenant) as Row & {
    cap: number;
    reserved: number;
    spent: number;
}; }
async setBudgetForTest(tenant: string, cap: number) { await this.run('UPDATE budgets SET cap=? WHERE tenant=?', cap, tenant); }
async count(table: string) { if (!['inbox', 'jobs', 'calls', 'commands', 'reservations', 'audit', 'dlq', 'slots', 'human_tasks', 'confirmations'].includes(table))
    throw new Error('Invalid table'); return Number((await this.one('SELECT count(*) AS n FROM ' + table))?.n); }
async snapshot() { return { inbox: await this.all('SELECT * FROM inbox'), audit: await this.all('SELECT * FROM audit'), calls: await this.all('SELECT * FROM calls') }; }
async claim(now: number) {
    return await this.transaction(async () => {
        // Only expired leases can be recovered; another active process retains ownership.
        for (const job of await this.all<Job>("SELECT * FROM jobs WHERE state='leased' AND lease_until<=?", now)) {
            if (job.kind === 'booking')
                await this.run("UPDATE commands SET state='unknown' WHERE tenant=? AND id=? AND state='attempted'", job.tenant, job.ref);
            await this.run("UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL WHERE id=?", job.id);
            await this.audit(job.tenant, 'LEASE_RECOVERED', job.ref, now);
        }
        const job = await this.one<Job>(`SELECT j.* FROM jobs j JOIN controls c ON c.tenant=j.tenant
    WHERE j.state='pending' AND j.due_ms<=? AND (c.kill=0 OR j.kind!='booking' OR EXISTS(SELECT 1 FROM commands b WHERE b.tenant=j.tenant AND b.id=j.ref AND b.state='unknown')) ORDER BY j.id LIMIT 1`, now);
        if (!job)
            return undefined;
        const token = randomUUID();
        await this.run("UPDATE jobs SET state='leased',lease_until=?,lease_token=?,attempts=attempts+1 WHERE id=?", now + this.config.leaseMs, token, job.id);
        return { ...job, lease_token: token, attempts: job.attempts + 1 };
    });
}
async owns(job: Job) { return !!await this.one("SELECT id FROM jobs WHERE id=? AND state='leased' AND lease_token=?", job.id, job.lease_token); }
async done(job: Job) { await this.run("UPDATE jobs SET state='done',lease_until=NULL,lease_token=NULL WHERE id=? AND lease_token=?", job.id, job.lease_token); }

}
