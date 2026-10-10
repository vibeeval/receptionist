import { randomUUID } from 'node:crypto';
import type { AsyncStore } from '../async-store.js';
/** Lease timestamps use the shared database clock in production. Injected time is for fixtures. */
export class MonitorLease {
 readonly owner=randomUUID();
 constructor(private db:AsyncStore,private now:()=>number|Promise<number>,readonly ttlMs=15000){}
 async migrate(){await this.db.run('CREATE TABLE IF NOT EXISTS monitor_owners(account TEXT NOT NULL,call_id TEXT NOT NULL,owner TEXT NOT NULL,epoch BIGINT NOT NULL,until_ms BIGINT NOT NULL,PRIMARY KEY(account,call_id))');}
 async acquire(account:string,call:string):Promise<number|undefined>{return this.db.transaction(async()=>{
  const row=await this.db.one('SELECT * FROM monitor_owners WHERE account=? AND call_id=?',account,call);
  if(row&&Number(row.until_ms)>(await this.now()))return undefined;
  const epoch=Math.max(Number(row?.epoch??0),Number((await this.db.one('SELECT epoch FROM monitor_sessions WHERE account=? AND call_id=?',account,call))?.epoch??0))+1;
  await this.db.run('INSERT INTO monitor_owners VALUES(?,?,?,?,?) ON CONFLICT(account,call_id) DO UPDATE SET owner=excluded.owner,epoch=excluded.epoch,until_ms=excluded.until_ms',account,call,this.owner,epoch,(await this.now())+this.ttlMs);return epoch;
 });}
 async valid(account:string,call:string,epoch:number,db=this.db,own=true){const r=await db.one('SELECT * FROM monitor_owners WHERE account=? AND call_id=?',account,call);return !!r&&(!own||r.owner===this.owner)&&Number(r.epoch)===epoch&&Number(r.until_ms)>(await this.now());}
 async renew(account:string,call:string,epoch:number){return this.db.transaction(async()=>{if(!await this.valid(account,call,epoch))return false;await this.db.run('UPDATE monitor_owners SET until_ms=? WHERE account=? AND call_id=? AND owner=? AND epoch=?',(await this.now())+this.ttlMs,account,call,this.owner,epoch);return true;});}
 async release(account:string,call:string,epoch:number){await this.db.run('UPDATE monitor_owners SET until_ms=0 WHERE account=? AND call_id=? AND owner=? AND epoch=?',account,call,this.owner,epoch);}
}
