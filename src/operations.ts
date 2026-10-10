import type { AsyncStore } from './async-store.js';
export type OpsCode='READY'|'NOT_READY'|'WORKER_UNAVAILABLE'|'QUEUE_ATTENTION'|'SHUTDOWN_STARTED'|'SHUTDOWN_COMPLETE'|'SHUTDOWN_TIMEOUT';
const allowed=new Set<OpsCode>(['READY','NOT_READY','WORKER_UNAVAILABLE','QUEUE_ATTENTION','SHUTDOWN_STARTED','SHUTDOWN_COMPLETE','SHUTDOWN_TIMEOUT']);
export function redactedLog(sink:(entry:object)=>void,code:OpsCode,counts:Record<string,unknown>={},providerMock=true){
 const out:Record<string,unknown>={code:allowed.has(code)?code:'NOT_READY',providerMock};
 for(const k of ['dlq','overdue','active'])if(typeof counts[k]==='number'&&Number.isSafeInteger(counts[k])&&Number(counts[k])>=0)out[k]=counts[k];
 try{sink(out);}catch{/* telemetry failure must not mutate booking state */}
}
export class Operations {
 stopping=false; workerFailed=false;
 constructor(private db:AsyncStore,private sink:(entry:object)=>void=()=>{},private clock:()=>number=Date.now,private providerMock=true){}
 async ready(){
  if(this.stopping||this.workerFailed)return false;
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{const ready=await Promise.race([this.db.one('SELECT 1 AS ok').then(r=>r?.ok===1),new Promise<false>(r=>{timer=setTimeout(()=>r(false),500);})]);return ready&&!this.stopping&&!this.workerFailed;}catch{return false;}finally{if(timer)clearTimeout(timer);}
 }
 workerFailure(){this.workerFailed=true;redactedLog(this.sink,'WORKER_UNAVAILABLE',{},this.providerMock);}
 async alerts(){const dlq=(await this.db.all("SELECT job_id FROM dlq WHERE state='needs_operator'")).length,overdue=(await this.db.all("SELECT id FROM jobs WHERE state IN('pending','leased') AND due_ms<?",this.clock()-60000)).length;
  if(dlq||overdue)redactedLog(this.sink,'QUEUE_ATTENTION',{dlq,overdue},this.providerMock);return {dlq,overdue};}
 beginShutdown(){this.stopping=true;redactedLog(this.sink,'SHUTDOWN_STARTED',{},this.providerMock);}
}
export async function settleWorker(work:Promise<unknown>|undefined,timeoutMs=5000){
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([Promise.resolve(work).then(()=>true,()=>true),new Promise<false>(r=>{timer=setTimeout(()=>r(false),timeoutMs);})]);}finally{if(timer)clearTimeout(timer);}
}
