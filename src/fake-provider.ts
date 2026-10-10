import { DatabaseSync } from 'node:sqlite';
import { mkdirSync,chmodSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { CalendarPort,CrmPort,Receipt } from './ports.js';
export class ProviderFault extends Error {constructor(public readonly outcome:'no_effect_retryable'|'no_effect_terminal'|'unknown'){super(outcome);}}
export class SimulatedCrash extends Error {constructor(){super('SIMULATED_CRASH');}}
export type FakeMode='none'|'retryable'|'terminal'|'after_commit_timeout'|'crash_after_commit'|'unknown';
/** A durable fake external system. No network implementation exists here. */
export class FakeProvider implements CalendarPort,CrmPort {
 readonly providerMock=true;
 readonly db:DatabaseSync;
 constructor(path:string){mkdirSync(dirname(path),{recursive:true,mode:0o700});this.db=new DatabaseSync(path);chmodSync(path,0o600);this.db.exec(`PRAGMA busy_timeout=10000; PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL;
 CREATE TABLE IF NOT EXISTS faults(target TEXT PRIMARY KEY,mode TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS stats(name TEXT PRIMARY KEY,n INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS bookings(tenant TEXT NOT NULL,command_id TEXT NOT NULL,slot_id TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(tenant,command_id),UNIQUE(tenant,slot_id));
 CREATE TABLE IF NOT EXISTS crm(tenant TEXT NOT NULL,command_id TEXT NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(tenant,command_id));`);}
 setFault(target:'booking'|'crm',mode:FakeMode){this.db.prepare('INSERT INTO faults VALUES(?,?) ON CONFLICT(target) DO UPDATE SET mode=excluded.mode').run(target,mode);}
 private mode(target:string){return this.db.prepare('SELECT mode FROM faults WHERE target=?').get(target)?.mode??'none';}
 private increment(){this.db.prepare("INSERT INTO stats VALUES('book',1) ON CONFLICT(name) DO UPDATE SET n=n+1").run();}
 async book(tenant:string,command:string,slot:string):Promise<Receipt>{
  this.increment();const mode=this.mode('booking');
  if(mode==='retryable')throw new ProviderFault('no_effect_retryable');if(mode==='terminal')throw new ProviderFault('no_effect_terminal');if(mode==='unknown')throw new ProviderFault('unknown');
  this.db.exec('BEGIN IMMEDIATE');let receipt:string;
  try{
   const old=this.db.prepare('SELECT receipt,slot_id FROM bookings WHERE tenant=? AND command_id=?').get(tenant,command);
   if(old){if(old.slot_id!==slot)throw new ProviderFault('no_effect_terminal');receipt=String(old.receipt);}
   else {if(this.db.prepare('SELECT receipt FROM bookings WHERE tenant=? AND slot_id=?').get(tenant,slot))throw new ProviderFault('no_effect_terminal');receipt='fake-'+randomUUID();this.db.prepare('INSERT INTO bookings VALUES(?,?,?,?)').run(tenant,command,slot,receipt);}
   this.db.exec('COMMIT');
  }catch(e){this.db.exec('ROLLBACK');throw e;}
  if(mode==='crash_after_commit')throw new SimulatedCrash();if(mode==='after_commit_timeout')throw new ProviderFault('unknown');return {id:receipt,providerMock:true};
 }
 async lookup(tenant:string,command:string):Promise<{status:'confirmed';receipt:Receipt}|{status:'absent'|'unknown'}>{
  const r=this.db.prepare('SELECT receipt FROM bookings WHERE tenant=? AND command_id=?').get(tenant,command);
  if(r)return {status:'confirmed',receipt:{id:String(r.receipt),providerMock:true}};
  return {status:this.mode('booking')==='unknown'?'unknown':'absent'};
 }
 async upsertCrm(tenant:string,command:string,receipt:string){if(this.mode('crm')!=='none')throw new ProviderFault('no_effect_retryable');this.db.prepare('INSERT INTO crm VALUES(?,?,?) ON CONFLICT(tenant,command_id) DO UPDATE SET receipt=excluded.receipt').run(tenant,command,receipt);}
 bookingCount(){return Number(this.db.prepare('SELECT count(*) n FROM bookings').get()?.n);}
 crmCount(){return Number(this.db.prepare('SELECT count(*) n FROM crm').get()?.n);}
 bookAttempts(){return Number(this.db.prepare("SELECT n FROM stats WHERE name='book'").get()?.n??0);}
 close(){this.db.close();}
}
