import { AsyncLocalStorage } from 'node:async_hooks';
import { Store,type Row,type Command,type Job } from './store.js';
import type { SQLInputValue } from 'node:sqlite';
export interface AsyncStore {
 transaction<T>(fn:()=>Promise<T>):Promise<T>;
 run(sql:string,...params:SQLInputValue[]):Promise<unknown>;
 one<T extends Row=Row>(sql:string,...params:SQLInputValue[]):Promise<T|undefined>;
 all<T extends Row=Row>(sql:string,...params:SQLInputValue[]):Promise<T[]>;
 audit(tenant:string,action:string,ref:string,now:number):Promise<void>;
 enqueue(tenant:string,kind:string,ref:string,now:number):Promise<void>;
 command(tenant:string,id:string):Promise<Command|undefined>;
 call(tenant:string,id:string):Promise<Row|undefined>;
 killed(tenant:string):Promise<boolean>;
 budget(tenant:string):Promise<Row&{cap:number;reserved:number;spent:number}>;
 claim(now:number):Promise<Job|undefined>;
 owns(job:Job):Promise<boolean>;
 done(job:Job):Promise<void>;
}
// A process-wide queue prevents a synchronous SQLite busy wait from blocking
// the owner of an async transaction on another connection in this event loop.
const tails=new Map<string,Promise<void>>();
export class SqliteAsyncStore implements AsyncStore {
 private context=new AsyncLocalStorage<boolean>();
 constructor(private store:Store){}
 private async exclusive<T>(fn:()=>T|Promise<T>):Promise<T>{
  if(this.context.getStore())return fn();
  const key=this.store.config.dbPath,previous=tails.get(key)??Promise.resolve();let release!:()=>void;
  const next=new Promise<void>(r=>{release=r;});tails.set(key,next);await previous;
  try{return await this.context.run(true,fn);}finally{release();if(tails.get(key)===next)tails.delete(key);}
 }
 transaction<T>(fn:()=>Promise<T>):Promise<T>{return this.exclusive(async()=>{this.store.db.exec('BEGIN IMMEDIATE');try{const result=await fn();this.store.db.exec('COMMIT');return result;}catch(e){this.store.db.exec('ROLLBACK');throw e;}});}
 run(sql:string,...p:SQLInputValue[]){return this.exclusive(()=>this.store.run(sql,...p));}
 one<T extends Row=Row>(sql:string,...p:SQLInputValue[]){return this.exclusive(()=>this.store.one<T>(sql,...p));}
 all<T extends Row=Row>(sql:string,...p:SQLInputValue[]){return this.exclusive(()=>this.store.all<T>(sql,...p));}
 async audit(t:string,a:string,r:string,n:number){await this.exclusive(()=>this.store.audit(t,a,r,n));}
 async enqueue(t:string,k:string,r:string,n:number){await this.exclusive(()=>this.store.enqueue(t,k,r,n));}
 command(t:string,id:string){return this.exclusive(()=>this.store.command(t,id));}
 call(t:string,id:string){return this.exclusive(()=>this.store.call(t,id));}
 killed(t:string){return this.exclusive(()=>this.store.killed(t));}
 budget(t:string){return this.exclusive(()=>this.store.budget(t));}
 claim(n:number){return this.exclusive(()=>this.store.claim(n));}
 owns(j:Job){return this.exclusive(()=>this.store.owns(j));}
 async done(j:Job){await this.exclusive(()=>this.store.done(j));}
}
