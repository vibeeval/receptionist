import { z } from 'zod';
import { MonitorLease } from './lease.js';
import { randomBytes } from 'node:crypto';
import type { AsyncStore } from '../async-store.js';
import type { Config } from '../config.js';
import type { Engine,Request,Result } from '../engine.js';
import { AppError,canonical,digest,signRequest } from '../security.js';
import { verifyRetell,type RetellAccount } from '../providers/retell.js';
import { migrateAutonomous } from './schema.js';
import type { MonitorConnection,MonitorTransport } from './transport.js';
import { FLOW_DIGEST,NODES } from './flow.js';
const identifier=z.string().regex(/^[A-Za-z0-9_-]{1,128}$/);
const item=z.object({id:identifier,time_sec:z.number().finite().min(0).max(86400),role:z.enum(['user','agent','tool_call_invocation','tool_call_result','node_transition','dtmf','sms','injected']),content:z.string().max(32768).optional(),digit:z.string().length(1).optional(),tool_call_id:identifier.optional(),name:z.string().max(128).optional(),successful:z.boolean().optional(),arguments:z.string().max(32768).optional(),former_node_id:identifier.optional(),new_node_id:identifier.optional(),transition_type:z.enum(['normal','global','global_go_back','interrupt_go_back']).optional()});
const frame=z.discriminatedUnion('type',[z.object({type:z.literal('transcript_snapshot'),transcripts:z.array(item).max(5000),pre_session_transcripts:z.array(z.unknown()).max(1000)}),z.object({type:z.literal('transcript_updated'),transcripts:z.array(item).max(1),pre_session_transcripts:z.array(z.unknown()).optional()}),z.object({type:z.literal('call_ended'),event_timestamp:z.number().int(),disconnection_reason:z.string()})]);
const tool=z.discriminatedUnion('name',[z.object({name:z.literal('auto_propose'),args:z.object({slotId:z.string().regex(/^[A-Za-z0-9_-]{1,64}$/)}).strict(),call:z.object({call_id:identifier,agent_id:identifier,agent_version:z.number().int()})}).strict(),z.object({name:z.literal('auto_commit'),args:z.object({proposalId:z.string().regex(/^[a-f0-9]{64}$/),nonce:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),call:z.object({call_id:identifier,agent_id:identifier,agent_version:z.number().int()})}).strict()]);
export type FlowPins=Record<string,{agentVersion:number;flowId:string;flowVersion:number;artifactSha256:string}>;
type Core=Pick<Engine,'config'|'request'>;
export class AutonomousConfirmation {
 private pending=new Map<string,Promise<void>>();private connecting=new Set<string>();private connections=new Map<string,MonitorConnection>();private queues=new Map<string,Promise<void>>();private localEpochs=new Map<string,number>();private recoveryFailures=0;private timers=new Set<ReturnType<typeof setTimeout>>();private stopping=false;private lease:MonitorLease;private heartbeats=new Map<string,ReturnType<typeof setInterval>>();
 private constructor(private core:Core,private db:AsyncStore,private accounts:RetellAccount[],private pins:FlowPins,private transport:MonitorTransport,private now:()=>number,leaseClock?:()=>Promise<number>){this.lease=new MonitorLease(db,leaseClock??now);}
 static validatePins(accounts:RetellAccount[],pins:FlowPins){if(accounts.some(a=>a.agentIds.some(id=>!pins[id]||pins[id]!.artifactSha256!==FLOW_DIGEST)))throw new Error('PINNED_FLOW_REQUIRED');}
 static async open(core:Core,db:AsyncStore,accounts:RetellAccount[],pins:FlowPins,transport:MonitorTransport,now:()=>number,leaseClock?:()=>Promise<number>){
  if(!transport||typeof transport.connect!=='function'||accounts.some(a=>a.agentIds.some(id=>!pins[id]||pins[id]!.artifactSha256!==FLOW_DIGEST)))throw new Error('PINNED_FLOW_AND_MONITOR_REQUIRED');
  this.validatePins(accounts,pins);await migrateAutonomous(db);const c=new AutonomousConfirmation(core,db,accounts,pins,transport,now,leaseClock);
  await c.lease.migrate();c.scheduleRecovery(5000);return c;
 }
 private scheduleRecovery(delay:number){if(this.stopping)return;const timer=setTimeout(()=>{this.timers.delete(timer);void this.recover().then(()=>{this.recoveryFailures=0;},()=>{this.recoveryFailures=Math.min(this.recoveryFailures+1,4);}).finally(()=>this.scheduleRecovery(this.recoveryFailures?Math.min(1000*2**(this.recoveryFailures-1),8000):5000));},delay);timer.unref();this.timers.add(timer);}
 private async recover(){if(this.stopping)return;let failed=false;for(const s of await this.db.all('SELECT s.* FROM retell_sessions s JOIN calls c ON c.tenant=s.tenant AND c.id=s.core_call WHERE s.closed=0 AND c.started_ms>?',this.now()-this.core.config.maxCallDurationMs)){if(this.stopping)return;const pin=this.pins[String(s.agent)];if(pin)try{await this.connect(String(s.account),String(s.provider_call),String(s.agent),pin.agentVersion);}catch{failed=true;}}if(failed)throw new Error('MONITOR_RECOVERY_RETRY');}
 private dropLocal(key:string,epoch:number,close=false){if(this.localEpochs.get(key)!==epoch)return;const connection=this.connections.get(key),heartbeat=this.heartbeats.get(key);this.localEpochs.delete(key);this.connections.delete(key);this.heartbeats.delete(key);if(heartbeat)clearInterval(heartbeat);if(close)connection?.close();}
 private async bound(account:string,callId:string,agent?:string,version?:number){const a=this.accounts.find(x=>x.id===account);if(!a)throw new AppError(404,'NOT_FOUND');const s=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',account,callId);if(!s||Number(s.closed)!==0||!a.agentIds.includes(String(s.agent))||agent&&agent!==s.agent||version!==undefined&&this.pins[String(s.agent)]?.agentVersion!==version)throw new AppError(403,'MONITOR_SESSION_REQUIRED');return {account:a,session:s};}
 private async invalidate(account:string,callId:string,reason:string){await this.db.run("UPDATE auto_proposals SET state='invalid',reason=? WHERE account=? AND call_id=? AND state NOT IN('committed','declined','invalid')",reason,account,callId);}
 private enqueue(key:string,fn:()=>Promise<void>){if(this.stopping)return;const next=(this.queues.get(key)??Promise.resolve()).then(fn).catch(async()=>{await this.db.transaction(async()=>{const [account,callId]=key.split(':');const stream=await this.db.one('SELECT epoch FROM monitor_sessions WHERE account=? AND call_id=?',account!,callId!);if(!stream||!await this.lease.valid(account!,callId!,Number(stream.epoch)))return;await this.invalidate(account!,callId!,'monitor_invalid');await this.db.run("UPDATE monitor_sessions SET status='invalid' WHERE account=? AND call_id=?",account!,callId!);}).catch(()=>{});});this.queues.set(key,next);}
 async flush(){await Promise.all(this.queues.values());}
 async connect(account:string,callId:string,agent:string,version:number){const key=account+':'+callId;const existing=this.pending.get(key);if(existing)return existing;const work=this.connectOnce(account,callId,agent,version);this.pending.set(key,work);try{await work;}finally{this.pending.delete(key);}}
 private async connectOnce(account:string,callId:string,agent:string,version:number){
  if(this.stopping)throw new Error('STOPPING');if(!Number.isInteger(version))throw new Error('AGENT_VERSION_REQUIRED');await this.bound(account,callId,agent,version);if(this.stopping)throw new Error('STOPPING');
  const key=account+':'+callId;if(this.connections.has(key)||this.connecting.has(key))return;if(this.connections.size+this.connecting.size>=100)throw new Error('MONITOR_LIMIT');this.connecting.add(key);let epoch:number|undefined;let opening:MonitorConnection|undefined;
  try{
   epoch=await this.lease.acquire(account,callId);if(epoch===undefined)return;const ownedEpoch=epoch;this.localEpochs.set(key,ownedEpoch);
   await this.db.transaction(async()=>{if(!await this.lease.valid(account,callId,ownedEpoch))throw new Error('MONITOR_LEASE_LOST');await this.invalidate(account,callId,'reconnect');await this.db.run("INSERT INTO monitor_sessions VALUES(?,?,?,'syncing',0) ON CONFLICT(account,call_id) DO UPDATE SET epoch=excluded.epoch,status='syncing'",account,callId,ownedEpoch);});
   if(this.stopping)throw new Error('STOPPING');let renewing=false;
   const heartbeat=setInterval(()=>{if(renewing||this.stopping)return;renewing=true;void this.lease.renew(account,callId,ownedEpoch).catch(()=>false).then(ok=>{if(!ok){this.dropLocal(key,ownedEpoch,true);this.enqueue(key,()=>this.disconnected(account,callId,ownedEpoch,1011,'lease_lost'));}}).finally(()=>{renewing=false;});},3000);heartbeat.unref();this.heartbeats.set(key,heartbeat);
   const a=this.accounts.find(x=>x.id===account)!;
   const connection=opening=await this.transport.connect({url:'wss://api.retellai.com/v2/monitor-call/'+callId,key:a.key,message:data=>this.enqueue(key,()=>this.receive(account,callId,ownedEpoch,data)),closed:(code,reason)=>{this.dropLocal(key,ownedEpoch);this.enqueue(key,()=>this.disconnected(account,callId,ownedEpoch,code,reason));}});
   const valid=await this.lease.valid(account,callId,ownedEpoch);if(this.stopping||!valid||this.localEpochs.get(key)!==ownedEpoch){this.dropLocal(key,ownedEpoch);connection.close();return;}this.connections.set(key,connection);opening=undefined;
  }catch(error){opening?.close();if(epoch!==undefined){this.dropLocal(key,epoch,true);await this.disconnected(account,callId,epoch,1011,'connect_failed').catch(()=>{});}throw error;}finally{this.connecting.delete(key);}
 }
 private async disconnected(account:string,callId:string,epoch:number,code:number,reason:string){this.dropLocal(account+':'+callId,epoch);await this.db.transaction(async()=>{const s=await this.db.one('SELECT epoch FROM monitor_sessions WHERE account=? AND call_id=?',account,callId);const owner=await this.db.one('SELECT owner,epoch FROM monitor_owners WHERE account=? AND call_id=?',account,callId);if(Number(s?.epoch)!==epoch||owner?.owner!==this.lease.owner||Number(owner?.epoch)!==epoch)return;await this.lease.release(account,callId,epoch);await this.invalidate(account,callId,'stream_disconnect');await this.db.run("UPDATE monitor_sessions SET status='disconnected' WHERE account=? AND call_id=?",account,callId);if(code===1000&&reason==='call_ended')await this.end(account,callId);});}
 private async end(account:string,callId:string){const session=await this.db.one('SELECT * FROM retell_sessions WHERE account=? AND provider_call=?',account,callId);if(!session)return;await this.invalidate(account,callId,'call_ended');await this.db.run('UPDATE retell_sessions SET closed=1 WHERE account=? AND provider_call=?',account,callId);await this.db.run("INSERT OR IGNORE INTO booking_admission_gates VALUES(?,?,'monitor_ended')",session.tenant!,session.core_call!);await this.db.run("UPDATE calls SET state='ended' WHERE tenant=? AND id=? AND state IN('active','eligible')",session.tenant!,session.core_call!);await this.db.run("UPDATE monitor_sessions SET status='closed' WHERE account=? AND call_id=?",account,callId);}
 async lifecycle(r:Request){const m=/^\/providers\/retell\/([a-z0-9-]+)\/events$/.exec(r.path);if(!m)return;const a=this.accounts.find(x=>x.id===m[1]);if(!a)return;const raw=await verifyRetell(r.body,r.headers['x-retell-signature'],a.key);const e=JSON.parse(raw);if(e.event==='call_started')await this.connect(a.id,e.call.call_id,e.call.agent_id,e.call.agent_version);else await this.db.transaction(()=>this.end(a.id,e.call.call_id));}
 private async receive(account:string,callId:string,epoch:number,data:string){await this.db.transaction(async()=>{
  const stream=await this.db.one('SELECT * FROM monitor_sessions WHERE account=? AND call_id=?',account,callId);if(!stream||!await this.lease.valid(account,callId,epoch)||Number(stream.epoch)!==epoch||!['syncing','live'].includes(String(stream.status)))return;
  if(Buffer.byteLength(data)>262144)throw new Error('MONITOR_FRAME_TOO_LARGE');const f=frame.parse(JSON.parse(data));
  if(f.type==='call_ended'){await this.end(account,callId);return;}
  const authorize=f.type==='transcript_updated'&&stream.status==='live';
  for(const e of f.transcripts){const hash=digest(canonical(e)),ms=Math.floor(e.time_sec*1000),old=await this.db.one('SELECT * FROM monitor_items WHERE account=? AND call_id=? AND item_id=?',account,callId,e.id);
   const p=await this.db.one("SELECT * FROM auto_proposals WHERE account=? AND call_id=? AND state NOT IN('committed','invalid','declined') ORDER BY revision DESC LIMIT 1",account,callId);
   if(old?.hash===hash)continue;
   const timing=p&&await this.db.one('SELECT * FROM auto_timing WHERE proposal_id=?',p.id!);
   const proof=p&&await this.db.one('SELECT * FROM auto_tool_proof WHERE proposal_id=?',p.id!);
   const knownInvocation=old&&p&&await this.db.one('SELECT * FROM auto_invocations WHERE account=? AND call_id=? AND item_id=?',account,callId,e.id);
   const selected=!!p&&([p.readback_item,p.dtmf_item,timing?.marker_item,timing?.entry_item,timing?.window_item,proof?.invocation_item,proof?.result_item].includes(e.id)||!!(knownInvocation&&Number(knownInvocation.epoch)===epoch&&knownInvocation.slot_id===p.slot_id)||!!(old&&await this.db.one('SELECT item_id FROM auto_time_edges WHERE proposal_id=? AND item_id=?',p.id!,e.id)));
   // Transcript growth retains its first-word timestamp. Only that one update is mutable.
   const growing=!!old&&!!p&&e.id===p.readback_item&&p.state==='readback'&&e.role==='agent'&&old.role==='agent'&&Number(old.at_ms)===ms&&authorize;
   if(!old&&Number((await this.db.one('SELECT count(*) n FROM monitor_items WHERE account=? AND call_id=?',account,callId))?.n)>=10000)throw new Error('MONITOR_ITEM_LIMIT');
   await this.db.run('INSERT INTO monitor_items VALUES(?,?,?,?,?,?) ON CONFLICT(account,call_id,item_id) DO UPDATE SET hash=excluded.hash,role=excluded.role,at_ms=excluded.at_ms',account,callId,e.id,hash,e.role,ms);
   await this.db.run('UPDATE monitor_sessions SET max_ms=CASE WHEN max_ms<? THEN ? ELSE max_ms END WHERE account=? AND call_id=?',ms,ms,account,callId);
   if(old&&selected&&!growing){if(knownInvocation)await this.db.run('UPDATE auto_invocations SET valid=0 WHERE account=? AND call_id=? AND item_id=?',account,callId,e.id);await this.invalidate(account,callId,'evidence_replacement');continue;}
   if(old&&old.role!==e.role&&p){await this.invalidate(account,callId,'role_replacement');continue;}
   if(e.role==='tool_call_invocation'&&e.name==='auto_propose'&&e.tool_call_id&&authorize){
    let args;try{args=JSON.parse(e.arguments??'{}');}catch{if(p)await this.invalidate(account,callId,'invalid_invocation');continue;}
    if(typeof args.slotId==='string')await this.db.run('INSERT INTO auto_invocations VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account,call_id,tool_call_id) DO UPDATE SET valid=0',account,callId,e.tool_call_id,e.id,hash,args.slotId,epoch,ms,old?0:1,p?.state==='proposed'&&p.slot_id===args.slotId?p.id!:null);
    if(old&&p){await this.invalidate(account,callId,'invocation_replacement');continue;}
   }
   if(!p)continue;if(Number(p.epoch)!==epoch||Number(p.expires_ms)<=this.now()||this.now()<Number(p.created_ms)){await this.invalidate(account,callId,'expiry_or_epoch');continue;}
   if(!authorize)continue;
   // Baseline history predates this proposal. Discard it; it cannot reopen authority.
   if(ms<=Number(p.floor_ms))continue;
   if(e.role==='dtmf'&&!old){
    if(!['waiting','authorized'].includes(String(p.state))||!timing||ms<=Math.max(Number(p.window_ms),Number(timing.last_transition_ms),Number(timing.dtmf_ms))){await this.invalidate(account,callId,'dtmf_time_order');continue;}
   }

   if(e.role==='tool_call_result'&&e.content&&e.successful!==false){
    const link=await this.db.one('SELECT * FROM auto_invocations WHERE account=? AND call_id=? AND tool_call_id=?',account,callId,e.tool_call_id??'');
    if(!link||Number(link.valid)!==1||link.slot_id!==p.slot_id||Number(link.epoch)!==epoch)continue;
    if(link.proposal_id!==null&&link.proposal_id!==p.id){await this.invalidate(account,callId,'invocation_generation');continue;}
    let result;try{result=JSON.parse(e.content);}catch{continue;}
    if(result.proposal_id===p.id&&result.nonce===p.nonce&&result.readback_text===p.readback&&p.state==='proposed'){
     if(old||ms<=Number(link.at_ms)){await this.invalidate(account,callId,'marker_time_order');continue;}
     if(await this.db.one('SELECT proposal_id FROM auto_tool_proof WHERE account=? AND call_id=? AND (invocation_item=? OR result_item=?)',account,callId,link.item_id!,e.id)){await this.invalidate(account,callId,'tool_evidence_reused');continue;}
     await this.db.run('UPDATE auto_invocations SET proposal_id=? WHERE account=? AND call_id=? AND tool_call_id=?',p.id!,account,callId,e.tool_call_id!);
     await this.db.run('INSERT INTO auto_tool_proof VALUES(?,?,?,?,?,?,?,?)',p.id!,account,callId,epoch,link.item_id!,link.hash!,e.id,hash);
     await this.db.run('INSERT INTO auto_timing(proposal_id,marker_item) VALUES(?,?)',p.id!,e.id);
     await this.db.run("UPDATE auto_proposals SET state='marked',marker_ms=? WHERE id=?",ms,p.id!);
    }
   }
   if(e.role==='node_transition'){
    if(e.transition_type!=='normal'){await this.invalidate(account,callId,'unexpected_transition');continue;}
    if(p.state==='proposed'&&e.former_node_id===NODES.collect&&e.new_node_id===NODES.propose)continue;
    if(p.state==='marked'&&e.former_node_id===NODES.propose&&e.new_node_id===NODES.readback){
     if(old||!timing||ms<=Number(p.marker_ms)){await this.invalidate(account,callId,'entry_time_order');continue;}
     await this.db.run('INSERT INTO auto_time_edges VALUES(?,?)',p.id!,e.id);
     await this.db.run('UPDATE auto_timing SET entry_item=?,entry_ms=?,last_transition_ms=? WHERE proposal_id=?',e.id,ms,ms,p.id!);
     await this.db.run("UPDATE auto_proposals SET state='readback' WHERE id=?",p.id!);continue;
    }
    if(p.state==='readback'&&e.former_node_id===NODES.readback&&e.new_node_id===NODES.wait){
     if(old||!timing||Number(p.readback_ok)!==1||timing.agent_ms===null||ms<=Number(timing.agent_ms)||ms<=Number(timing.entry_ms)){await this.invalidate(account,callId,'window_time_order');continue;}
     await this.db.run('INSERT INTO auto_time_edges VALUES(?,?)',p.id!,e.id);
     await this.db.run('UPDATE auto_timing SET window_item=?,last_transition_ms=? WHERE proposal_id=?',e.id,ms,p.id!);
     await this.db.run("UPDATE auto_proposals SET state='waiting',window_ms=? WHERE id=?",ms,p.id!);continue;
    }
    if(['waiting','authorized'].includes(String(p.state))&&((e.former_node_id===NODES.wait&&e.new_node_id===NODES.commit)||(e.former_node_id===NODES.commit&&e.new_node_id===NODES.wait)||(e.former_node_id===NODES.commit&&e.new_node_id===NODES.poll)||(e.former_node_id===NODES.poll&&e.new_node_id===NODES.commit))){
     if(old||!timing||ms<=Math.max(Number(timing.last_transition_ms),Number(timing.dtmf_ms))){await this.invalidate(account,callId,'transition_time_order');continue;}
     // A return to a response/poll node cannot reuse an unconsumed authorization.
     if(p.state==='authorized'&&e.new_node_id!==NODES.commit){await this.invalidate(account,callId,'authorization_window_reopened');continue;}
     await this.db.run('INSERT INTO auto_time_edges VALUES(?,?)',p.id!,e.id);
     await this.db.run('UPDATE auto_timing SET last_transition_ms=? WHERE proposal_id=?',ms,p.id!);continue;
    }
    await this.invalidate(account,callId,'unexpected_node_exit');
   }
   if(e.role==='agent'&&p.state==='readback'){
    if(!timing||ms<=Number(timing.entry_ms)||(old&&!growing)||(p.readback_item&&p.readback_item!==e.id)||typeof e.content!=='string'||!String(p.readback).startsWith(e.content)||e.content.length<Number(timing.agent_chars??0)){await this.invalidate(account,callId,'readback_time_order');continue;}
    await this.db.run('UPDATE auto_timing SET agent_ms=?,agent_chars=? WHERE proposal_id=?',ms,e.content.length,p.id!);
    await this.db.run('UPDATE auto_proposals SET readback_item=?,readback_ok=? WHERE id=?',e.id,e.content===p.readback?1:0,p.id!);
   }
   if(e.role==='dtmf'&&!old&&['waiting','authorized'].includes(String(p.state))&&ms>Number(p.window_ms)){
    if(e.digit==='2'){await this.db.run("UPDATE auto_proposals SET state='declined',reason='caller_dtmf_2' WHERE id=?",p.id!);continue;}
    if(e.digit!=='1'){await this.invalidate(account,callId,'ambiguous_digit');continue;}
    if(p.state==='authorized'){await this.invalidate(account,callId,'duplicate_confirmation');continue;}
    const session=await this.db.one('SELECT closed FROM retell_sessions WHERE account=? AND provider_call=?',account,callId),slot=await this.db.one('SELECT * FROM slots WHERE tenant=? AND id=?',p.tenant!,p.slot_id!);
    if(!session||Number(session.closed)!==0||!slot||digest(canonical(slot))!==p.slot_hash||await this.db.killed(String(p.tenant))||await this.db.one('SELECT call_id FROM cancellation_gates WHERE tenant=? AND call_id=?',p.tenant!,p.core_call!)){await this.invalidate(account,callId,'call_or_slot_blocked');continue;}
    await this.db.run('UPDATE auto_timing SET dtmf_ms=?,authorized_after_ms=? WHERE proposal_id=?',ms,timing!.last_transition_ms!,p.id!);
    await this.db.run("UPDATE auto_proposals SET state='authorized',dtmf_item=? WHERE id=?",e.id,p.id!);
    await this.db.run("UPDATE calls SET state='eligible' WHERE tenant=? AND id=? AND state='active'",p.tenant!,p.core_call!);
    await this.db.run('INSERT OR IGNORE INTO confirmations(tenant,id,call_id,slot_id,expires_ms,evidence_hash) VALUES(?,?,?,?,?,?)',p.tenant!,p.confirmation_id!,p.core_call!,p.slot_id!,p.expires_ms!,digest(account+':'+callId+':'+e.id+':'+p.id));
    await this.db.audit(String(p.tenant),'CALLER_DTMF_AUTHORIZED',String(p.id),this.now());
   }
  }
  if(f.type==='transcript_snapshot')await this.db.run("UPDATE monitor_sessions SET status='live' WHERE account=? AND call_id=?",account,callId);
 });}
 async guardReservation(tenant:string,callId:string,confirmation:string,db:AsyncStore){
  const p=await db.one('SELECT * FROM auto_proposals WHERE tenant=? AND confirmation_id=?',tenant,confirmation);
  if(!p||p.core_call!==callId||p.state!=='authorized'||Number(p.created_ms)>this.now()||Number(p.expires_ms)<=this.now())throw new AppError(409,'CALLER_DTMF_REQUIRED');
  const proof=await db.one('SELECT * FROM auto_tool_proof WHERE proposal_id=?',p.id!);
  if(!proof||Number(proof.epoch)!==Number(p.epoch)||proof.account!==p.account||proof.call_id!==p.call_id)throw new AppError(409,'TOOL_EVIDENCE_REQUIRED');
  const link=await db.one('SELECT * FROM auto_invocations WHERE account=? AND call_id=? AND item_id=?',p.account!,p.call_id!,proof.invocation_item!);
  if(!link||Number(link.valid)!==1||link.proposal_id!==p.id||Number(link.epoch)!==Number(p.epoch))throw new AppError(409,'TOOL_EVIDENCE_CHANGED');
  for(const [item,hash]of [[proof.invocation_item,proof.invocation_hash],[proof.result_item,proof.result_hash]]){
   const actual=await db.one('SELECT hash FROM monitor_items WHERE account=? AND call_id=? AND item_id=?',p.account!,p.call_id!,item!);
   if(actual?.hash!==hash)throw new AppError(409,'TOOL_EVIDENCE_CHANGED');
  }
  const timing=await db.one('SELECT * FROM auto_timing WHERE proposal_id=?',p.id!);
  if(!timing||[p.marker_ms,timing.entry_ms,timing.agent_ms,p.window_ms,timing.dtmf_ms,timing.authorized_after_ms].some(x=>x===null||x===undefined)||
   !(Number(p.marker_ms)<Number(timing.entry_ms)&&Number(timing.entry_ms)<Number(timing.agent_ms)&&Number(timing.agent_ms)<Number(p.window_ms)&&
    Number(p.window_ms)<=Number(timing.authorized_after_ms)&&Number(timing.authorized_after_ms)<Number(timing.dtmf_ms)))throw new AppError(409,'CONFIRMATION_TIME_ORDER');
  const stream=await db.one('SELECT * FROM monitor_sessions WHERE account=? AND call_id=?',p.account!,p.call_id!);
  const slot=await db.one('SELECT * FROM slots WHERE tenant=? AND id=?',tenant,p.slot_id!);
  if(!stream||!await this.lease.valid(String(p.account),String(p.call_id),Number(p.epoch),db,false)||stream.status!=='live'||Number(stream.epoch)!==Number(p.epoch)||!slot||digest(canonical(slot))!==p.slot_hash)throw new AppError(409,'PROPOSAL_CHANGED');
  await db.run("UPDATE auto_proposals SET state='committed' WHERE id=?",p.id!);
 }
 async handle(r:Request):Promise<Result>{try{const match=/^\/providers\/retell\/([a-z0-9-]+)\/autonomous$/.exec(r.path);if(!match||r.method!=='POST')throw new AppError(404,'NOT_FOUND');const a=this.accounts.find(x=>x.id===match[1]);if(!a)throw new AppError(404,'NOT_FOUND');const raw=await verifyRetell(r.body,r.headers['x-retell-signature'],a.key),t=tool.safeParse(JSON.parse(raw));if(!t.success)throw new AppError(400,'INVALID_AUTONOMOUS_TOOL');const input=t.data,b=await this.bound(a.id,input.call.call_id,input.call.agent_id,input.call.agent_version),tenant=String(b.session.tenant);
  if(input.name==='auto_propose')return await this.db.transaction(async()=>{const stream=await this.db.one('SELECT * FROM monitor_sessions WHERE account=? AND call_id=?',a.id,input.call.call_id);if(stream?.status!=='live'||!await this.lease.valid(a.id,input.call.call_id,Number(stream.epoch),this.db,false))return {status:202,body:{proposal_state:'resync',booking_state:'pending',result_text:'Bağlantı yenileniyor; henüz randevu oluşturulmadı.'}};
   const prior=await this.db.one('SELECT * FROM auto_proposals WHERE account=? AND call_id=? ORDER BY revision DESC LIMIT 1',a.id,input.call.call_id);
   if(prior&&prior.slot_id===input.args.slotId&&Number(prior.expires_ms)>this.now()&&Number(prior.epoch)===Number(stream.epoch)&&!['invalid','declined'].includes(String(prior.state)))return this.proposalResponse(prior);
   await this.invalidate(a.id,input.call.call_id,'new_revision');
   if(Number(prior?.revision??0)>=20)return {status:429,body:{code:'PROPOSAL_LIMIT',booking_state:'unavailable'}};
   const slot=await this.db.one('SELECT * FROM slots WHERE tenant=? AND id=?',tenant,input.args.slotId),call=await this.db.call(tenant,String(b.session.core_call));if(!slot||Number(slot.start_ms)<=this.now()||!call||!['active','eligible'].includes(String(call.state)))return {status:409,body:{code:'SLOT_OR_CALL_UNAVAILABLE',booking_state:'unavailable',result_text:'Öneri değişikliği kabul edilmedi; önceki onay iptal edildi.'}};
   const id=randomBytes(32).toString('hex'),nonce=randomBytes(32).toString('hex'),revision=Number(prior?.revision??0)+1;
   const date=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',dateStyle:'full',timeStyle:'short'}).format(Number(slot.start_ms));const endTime=new Intl.DateTimeFormat('tr-TR',{timeZone:'Europe/Istanbul',timeStyle:'short'}).format(Number(slot.end_ms));const readback=`${slot.service} için ${date} ile ${endTime} arasında, Türkiye saati ile önerilen randevuyu onaylamak için konuşmam bittikten sonra 1, reddetmek için 2 tuşuna basın.`;
   await this.db.run("INSERT INTO auto_proposals(id,nonce,revision,tenant,account,call_id,core_call,slot_id,slot_hash,slot_snapshot,time_zone,readback,epoch,floor_ms,created_ms,expires_ms,state,confirmation_id,command_id) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'proposed',?,?)",id,nonce,revision,tenant,a.id,input.call.call_id,b.session.core_call!,input.args.slotId,digest(canonical(slot)),canonical(slot),'Europe/Istanbul',readback,stream.epoch!,stream.max_ms!,this.now(),this.now()+90000,digest('confirmation:'+id),digest('command:'+id));
   return this.proposalResponse((await this.db.one('SELECT * FROM auto_proposals WHERE id=?',id))!);
  });
  const p=await this.db.one('SELECT * FROM auto_proposals WHERE id=?',input.args.proposalId);if(!p||p.account!==a.id||p.call_id!==input.call.call_id||p.tenant!==tenant||p.nonce!==input.args.nonce)throw new AppError(403,'PROPOSAL_BINDING_REQUIRED');
  if(Number(p.expires_ms)<=this.now()&&p.state!=='committed'){await this.db.transaction(()=>this.invalidate(a.id,input.call.call_id,'expired'));return {status:409,body:{booking_state:'expired',result_text:'Onay süresi doldu; randevu oluşturulmadı.'}};}
  if(!['authorized','committed'].includes(String(p.state)))return {status:202,body:{booking_state:['invalid','declined'].includes(String(p.state))?p.state:'pending',result_text:'Randevu henüz oluşturulmadı.'}};
  const tenantConfig=this.core.config.tenants.find(x=>x.id===tenant)!,path='/v1/tenants/'+tenantConfig.route+'/bookings',body=Buffer.from(JSON.stringify({commandId:p.command_id,callId:p.core_call,slotId:p.slot_id,confirmationId:p.confirmation_id})),ts=String(Math.floor(this.now()/1000));const r1=await this.core.request({method:'POST',path,body,headers:{'x-timestamp':ts,'x-signature':signRequest(tenantConfig.keys.tool,ts,'POST',path,body)}});if(![200,202].includes(r1.status))return r1;
  const command=await this.db.command(tenant,String(p.command_id));const confirmed=command?.state==='confirmed'&&!!command.provider_receipt;return {status:200,body:{booking_state:confirmed?'confirmed':Number(p.expires_ms)<=this.now()?'unavailable':(command&&['failed','cancelled'].includes(String(command.state))?command.state:'pending'),result_text:confirmed?'Randevunuz oluşturuldu.':'Randevunuz işleniyor; henüz tamamlanmadı.',proposal_id:p.id}};
 }catch(e){const x=e instanceof AppError?e:new AppError(503,'AUTONOMOUS_UNAVAILABLE');return {status:x.status,body:{code:x.code,booking_state:'unavailable',result_text:'Randevu oluşturulduğu doğrulanamadı; lütfen tekrar deneyin veya insan desteği isteyin.'}};}}
 private proposalResponse(p:Record<string,unknown>):Result{return {status:200,body:{proposal_state:'ready',proposal_id:p.id,nonce:p.nonce,revision:p.revision,readback_text:p.readback,expires_ms:p.expires_ms,booking_state:'pending'}};}
 async close(){let timer:ReturnType<typeof setTimeout>|undefined;try{await Promise.race([this.closeInternal(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('MONITOR_DRAIN_TIMEOUT')),5000);})]);}finally{if(timer)clearTimeout(timer);}}
 private async closeInternal(){this.stopping=true;for(const t of this.heartbeats.values())clearInterval(t);this.heartbeats.clear();for(const t of this.timers)clearTimeout(t);for(const c of this.connections.values())c.close();this.connections.clear();await Promise.allSettled(this.pending.values());await this.flush();await this.db.transaction(async()=>{for(const row of await this.db.all('SELECT * FROM monitor_owners WHERE owner=?',this.lease.owner)){if(!await this.lease.valid(String(row.account),String(row.call_id),Number(row.epoch)))continue;await this.invalidate(String(row.account),String(row.call_id),'shutdown');await this.db.run("UPDATE monitor_sessions SET status='disconnected' WHERE account=? AND call_id=?",row.account!,row.call_id!);await this.lease.release(String(row.account),String(row.call_id),Number(row.epoch));}});}
}
