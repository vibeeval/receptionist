import test from 'node:test';
import assert from 'node:assert/strict';
import { setup } from './fixture.js';
import { timeCases,rejectTimeCase } from './time-cases.js';
import { NODES } from '../../src/autonomous/flow.js';
import { migrateAutonomous } from '../../src/autonomous/schema.js';
for(const mode of timeCases)test('strict proposal time order: '+mode,async()=>{const h=await setup();try{await rejectTimeCase(h,mode);}finally{await h.close();}});
test('new proposal after rejection can authorize only after fresh monotonic readback and DTMF',async()=>{const h=await setup();try{
 const p=await h.propose();await h.window(p);await h.emit({id:'bad',role:'dtmf',time_sec:6,digit:'1'});assert.equal((await h.commit(p)).body.booking_state,'invalid');
 const next=await h.propose();assert.notEqual(next.nonce,p.nonce);await h.window(next,10);
 await h.emit({id:'poll_1',role:'node_transition',time_sec:17,former_node_id:NODES.wait,new_node_id:NODES.commit,transition_type:'normal'});
 await h.emit({id:'poll_2',role:'node_transition',time_sec:18,former_node_id:NODES.commit,new_node_id:NODES.poll,transition_type:'normal'});
 await h.emit({id:'poll_3',role:'node_transition',time_sec:19,former_node_id:NODES.poll,new_node_id:NODES.commit,transition_type:'normal'});
 await h.emit({id:'fresh_digit',role:'dtmf',time_sec:20,digit:'1'});assert.equal((await h.commit(next)).status,200);await h.app.engine.drain();assert.equal((await h.commit(next)).body.booking_state,'confirmed');assert.equal(h.stats().posts,1);
}finally{await h.close();}});
test('002 timing migration upgrades 001 without changing its checksum; mismatch rejects',async()=>{const h=await setup();try{
 const original=await h.app.db.one("SELECT checksum FROM autonomous_migrations WHERE version='001'");
 await h.app.db.run('DROP TABLE auto_timing');await h.app.db.run("DELETE FROM autonomous_migrations WHERE version='002-time-order'");await migrateAutonomous(h.app.db);
 assert.deepEqual(await h.app.db.one("SELECT checksum FROM autonomous_migrations WHERE version='001'"),original);
 await h.app.db.run("UPDATE autonomous_migrations SET checksum='invalid' WHERE version='002-time-order'");await assert.rejects(migrateAutonomous(h.app.db),/AUTONOMOUS_MIGRATION_MISMATCH/);
}finally{await h.close();}});
test('transaction guard rechecks time chain after caller authorization',async()=>{const h=await setup();try{
 const p=await h.propose();await h.window(p);await h.emit({id:'digit',role:'dtmf',time_sec:7,digit:'1'});
 await h.app.db.run('UPDATE auto_timing SET agent_ms=window_ms FROM auto_proposals WHERE auto_timing.proposal_id=auto_proposals.id');
 const result=await h.commit(p);assert.equal(result.status,409);assert.equal(result.body.code,'CONFIRMATION_TIME_ORDER');assert.equal((await h.app.db.all('SELECT * FROM commands')).length,0);assert.equal(h.stats().posts,0);
}finally{await h.close();}});
test('identical stable-ID delivery is idempotent, not a new equal-time authorization',async()=>{const h=await setup();try{
 const p=await h.propose();await h.window(p);const event={id:'same_digit',role:'dtmf',time_sec:7,digit:'1'};await h.emit(event);await h.emit(event);await h.snapshot([event]);
 assert.equal((await h.commit(p)).status,200);await h.app.engine.drain();assert.equal(h.stats().posts,1);assert.equal((await h.commit(p)).body.booking_state,'confirmed');
}finally{await h.close();}});
