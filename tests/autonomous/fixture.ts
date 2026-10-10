import assert from 'node:assert/strict';
import { fixture } from '../composition/fixture.js';
import type { MonitorTransport } from '../../src/autonomous/transport.js';
import { NODES } from '../../src/autonomous/flow.js';
export class Monitor implements MonitorTransport {
 streams:Parameters<MonitorTransport['connect']>[0][]=[];
 async connect(input:Parameters<MonitorTransport['connect']>[0]){this.streams.push(input);return {close:()=>{}};}
 emit(value:unknown,index=this.streams.length-1){this.streams[index]!.message(JSON.stringify(value));}
}
export async function setup(database?:{kind:'postgres';urlRef:string;schema:string;mode:'local-test'}){const monitor=new Monitor(),h=await fixture('test',monitor,database);assert.equal((await h.retell('events',{event:'call_started',call:h.call})).status,200);await h.app.engine.drain();const emit=async(e:object)=>{monitor.emit({type:'transcript_updated',transcripts:[e]});await h.app.autonomous!.flush();};const snapshot=async(transcripts:object[]=[])=>{monitor.emit({type:'transcript_snapshot',transcripts,pre_session_transcripts:[]});await h.app.autonomous!.flush();};await snapshot();
 const propose=async()=>{const r=await h.retell('autonomous',{name:'auto_propose',call:h.call,args:{slotId:'slot-future'}});assert.equal(r.status,200,JSON.stringify(r.body));return r.body;};
 const commit=(p:Record<string,unknown>)=>h.retell('autonomous',{name:'auto_commit',call:h.call,args:{proposalId:p.proposal_id,nonce:p.nonce}});
 const window=async(p:Record<string,unknown>,offset=0)=>{await emit({id:'inv_'+offset,role:'tool_call_invocation',time_sec:offset+1,name:'auto_propose',tool_call_id:'tool_'+offset,arguments:JSON.stringify({slotId:'slot-future'})});await emit({id:'result_'+offset,role:'tool_call_result',time_sec:offset+2,tool_call_id:'tool_'+offset,content:JSON.stringify(p),successful:true});await emit({id:'enter_'+offset,role:'node_transition',time_sec:offset+3,former_node_id:NODES.propose,new_node_id:NODES.readback,transition_type:'normal'});await emit({id:'agent_'+offset,role:'agent',time_sec:offset+4,content:String(p.readback_text).slice(0,20)});await emit({id:'agent_'+offset,role:'agent',time_sec:offset+4,content:p.readback_text});await emit({id:'wait_'+offset,role:'node_transition',time_sec:offset+6,former_node_id:NODES.readback,new_node_id:NODES.wait,transition_type:'normal'});};
 return {...h,monitor,emit,snapshot,propose,commit,window};}
