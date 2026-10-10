import assert from 'node:assert/strict';
import { NODES } from '../../src/autonomous/flow.js';
import type { setup } from './fixture.js';
export const timeCases=['entry-equal','entry-backward','agent-equal','agent-zero','window-equal','window-backward','window-before-entry','dtmf-equal','dtmf-backward','dtmf-rounded-equal','snapshot-entry','snapshot-window','snapshot-agent','snapshot-marker','agent-time-replaced','agent-text-regresses','dtmf-time-replaced','duplicate-dtmf','poll-equal','snapshot-poll','authorized-reopen','generation-id-reuse','reconnect-snapshot-replacement'] as const;
export type TimeCase=typeof timeCases[number];
export async function rejectTimeCase(h:Awaited<ReturnType<typeof setup>>,mode:TimeCase){
 let p=await h.propose();
 if(mode==='generation-id-reuse'){await h.window(p);await h.emit({id:'old-decline',role:'dtmf',time_sec:7,digit:'2'});const next=await h.propose();assert.notEqual(next.nonce,p.nonce);p=next;}
 const offset=mode==='generation-id-reuse'?10:0;
 await h.emit({id:'inv',role:'tool_call_invocation',time_sec:offset+1,name:'auto_propose',tool_call_id:'tool',arguments:'{"slotId":"slot-future"}'});
 await h.emit({id:'result',role:'tool_call_result',time_sec:offset+2,tool_call_id:'tool',content:JSON.stringify(p)});
 const entry={id:mode==='generation-id-reuse'?'enter_0':'entry',role:'node_transition',time_sec:mode==='entry-equal'?2:mode==='entry-backward'?1.5:offset+3,former_node_id:NODES.propose,new_node_id:NODES.readback,transition_type:'normal'};
 await h.emit(entry);
 const agent={id:'agent',role:'agent',time_sec:mode==='agent-equal'?3:mode==='agent-zero'?0:offset+4,content:p.readback_text};
 if(mode==='agent-time-replaced'||mode==='agent-text-regresses'){
  await h.emit({...agent,content:String(p.readback_text).slice(0,20)});
  await h.emit({...agent,time_sec:mode==='agent-time-replaced'?4.1:4,content:mode==='agent-text-regresses'?String(p.readback_text).slice(0,10):p.readback_text});
 }else await h.emit(agent);
 const window={id:'window',role:'node_transition',time_sec:mode==='window-equal'?4:mode==='window-backward'?3.5:mode==='window-before-entry'?2.5:offset+6,former_node_id:NODES.readback,new_node_id:NODES.wait,transition_type:'normal'};
 await h.emit(window);
 if(mode==='snapshot-entry')await h.snapshot([{...entry,time_sec:2.5}]);
 if(mode==='snapshot-window')await h.snapshot([{...window,time_sec:5}]);
 if(mode==='snapshot-agent')await h.snapshot([{...agent,time_sec:4.1}]);
 if(mode==='snapshot-marker')await h.snapshot([{id:'result',role:'tool_call_result',time_sec:1.5,tool_call_id:'tool',content:JSON.stringify(p)}]);
 if(mode==='poll-equal'||mode==='snapshot-poll'){
  await h.emit({id:'poll1',role:'node_transition',time_sec:7,former_node_id:NODES.wait,new_node_id:NODES.commit,transition_type:'normal'});
  await h.emit({id:'poll2',role:'node_transition',time_sec:mode==='poll-equal'?7:8,former_node_id:NODES.commit,new_node_id:NODES.poll,transition_type:'normal'});
 }
 if(mode==='reconnect-snapshot-replacement'){
  h.monitor.streams[0]!.closed(4008,'test');await h.app.autonomous!.flush();await h.app.autonomous!.connect('account-a',h.call.call_id,'agent-a',1);
  await h.snapshot([{...window,time_sec:5},{...agent,time_sec:3.5}]);const next=await h.propose();assert.notEqual(next.nonce,p.nonce);p=next;
  await h.window(p,10);await h.snapshot([{id:'wait_10',role:'node_transition',time_sec:14,former_node_id:NODES.readback,new_node_id:NODES.wait,transition_type:'normal'}]);
 }
 if(mode==='snapshot-poll')await h.snapshot([{id:'poll1',role:'node_transition',time_sec:20,former_node_id:NODES.wait,new_node_id:NODES.commit,transition_type:'normal'}]);
 const digitTime=mode==='dtmf-equal'?6:mode==='dtmf-backward'?5.9:mode==='dtmf-rounded-equal'?6.0001:mode==='snapshot-poll'?9:offset+7;
 await h.emit({id:'digit',role:'dtmf',time_sec:digitTime,digit:'1'});
 if(mode==='dtmf-time-replaced')await h.emit({id:'digit',role:'dtmf',time_sec:8,digit:'1'});
 if(mode==='duplicate-dtmf')await h.emit({id:'second_digit',role:'dtmf',time_sec:8,digit:'1'});
 if(mode==='authorized-reopen'){
  await h.emit({id:'leave_wait',role:'node_transition',time_sec:8,former_node_id:NODES.wait,new_node_id:NODES.commit,transition_type:'normal'});
  await h.emit({id:'reopen_wait',role:'node_transition',time_sec:9,former_node_id:NODES.commit,new_node_id:NODES.wait,transition_type:'normal'});
 }
 await h.commit(p);await h.app.engine.drain();assert.equal((await h.app.db.all('SELECT * FROM commands')).length,0);assert.equal(h.stats().posts,0);
 assert.equal((await h.app.db.one('SELECT state FROM auto_proposals WHERE id=?',String(p.proposal_id)))?.state,'invalid');
 const next=await h.propose();assert.notEqual(next.nonce,p.nonce);assert.equal((await h.commit(next)).body.booking_state,'pending');
}
