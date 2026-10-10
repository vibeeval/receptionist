import assert from 'node:assert/strict';
import type { setup } from './fixture.js';
export const revokeCases=['waiting-missing','authorized-missing','waiting-past','authorized-past','waiting-valid','authorized-valid','waiting-same','authorized-same','invocation-hash','result-hash','snapshot-invocation-before-marker','invocation-generation-reuse'] as const;
export async function checkRevocation(h:Awaited<ReturnType<typeof setup>>,mode:typeof revokeCases[number]){
 const p=await h.propose();
 if(mode==='snapshot-invocation-before-marker'){
  const inv={id:'pre_inv',role:'tool_call_invocation',time_sec:1,name:'auto_propose',tool_call_id:'pre_tool',arguments:'{"slotId":"slot-future"}'};
  await h.emit(inv);await h.snapshot([{...inv,arguments:'{"slotId":"wrong"}'}]);await h.window(p,10);await h.emit({id:'new1',role:'dtmf',time_sec:17,digit:'1'});
  await h.commit(p);await h.app.engine.drain();assert.equal(h.stats().posts,0);assert.equal((await h.app.db.one('SELECT state FROM auto_proposals WHERE id=?',String(p.proposal_id)))?.state,'invalid');return;
 }
 await h.window(p);
 const authorized=mode.startsWith('authorized')||mode.endsWith('-hash')||mode==='invocation-generation-reuse';
 if(authorized)await h.emit({id:'one',role:'dtmf',time_sec:7,digit:'1'});
 if(mode.endsWith('-hash')){
  await h.app.db.run('UPDATE monitor_items SET hash=? WHERE item_id=?','0'.repeat(64),mode==='invocation-hash'?'inv_0':'result_0');
  const result=await h.commit(p);assert.equal(result.status,409);assert.equal(result.body.code,'TOOL_EVIDENCE_CHANGED');assert.equal((await h.app.db.all('SELECT * FROM commands')).length,0);assert.equal(h.stats().posts,0);return;
 }
 const suffix=mode.split('-').at(-1),slot=suffix==='same'?'slot-future':suffix==='valid'?'alternate-slot':suffix==='past'?'past-slot':'missing-slot';
 if(suffix==='valid'||suffix==='past'){
  const old=await h.app.db.one("SELECT * FROM slots WHERE tenant='tenant-a' AND id='slot-future'");const start=suffix==='past'?h.call.start_timestamp-60000:Number(old!.end_ms)+3600000;
  await h.app.db.run('INSERT INTO slots VALUES(?,?,?,?,?,?)','tenant-a',slot,'alternate-resource',start,start+30000,'alternate-service');
 }
 const r=await h.retell('autonomous',{name:'auto_propose',call:h.call,args:{slotId:slot}});
 if(suffix==='same'){
  assert.equal(r.status,200);assert.equal(r.body.nonce,p.nonce);if(!authorized)await h.emit({id:'fresh',role:'dtmf',time_sec:7,digit:'1'});assert.equal((await h.commit(p)).status,200);await h.app.engine.drain();assert.equal(h.stats().posts,1);return;
 }
 assert.equal(r.status,suffix==='valid'?200:409);
 assert.equal((await h.app.db.one('SELECT state FROM auto_proposals WHERE id=?',String(p.proposal_id)))?.state,'invalid');
 await h.commit(p);await h.app.engine.drain();assert.equal(h.stats().posts,0);assert.equal((await h.app.db.all('SELECT * FROM commands')).length,0);
 if(mode==='invocation-generation-reuse'){
  const next=await h.propose();assert.notEqual(next.nonce,p.nonce);
  await h.emit({id:'reused_result',role:'tool_call_result',time_sec:8,tool_call_id:'tool_0',content:JSON.stringify(next),successful:true});
  assert.equal((await h.commit(next)).body.booking_state,'invalid');assert.equal(h.stats().posts,0);
 }else if(suffix==='valid'){assert.notEqual(r.body.nonce,p.nonce);assert.equal((await h.commit(r.body)).body.booking_state,'pending');}
 else {const next=await h.propose();assert.notEqual(next.nonce,p.nonce);assert.equal((await h.commit(next)).body.booking_state,'pending');}
}
