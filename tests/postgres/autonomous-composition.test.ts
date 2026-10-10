import '../composition/no-egress.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { setup } from '../autonomous/fixture.js';
import { PgStore } from '../../src/pg-store.js';
for(const scenario of ['happy','slot-drift','atomic-rollback'] as const)test('real PG composition autonomous '+scenario,async()=>{
 const schema='phone_test_auto_'+randomBytes(6).toString('hex');const h=await setup({kind:'postgres',mode:'local-test',urlRef:'env:POSTGRES_TEST_URL',schema});
 try{assert.ok(h.app.engine.store instanceof PgStore);const p=await h.propose();await h.window(p);await h.emit({id:'digit',role:'dtmf',time_sec:7,digit:'1'});
  if(scenario==='slot-drift')await h.app.db.run("UPDATE slots SET start_ms=start_ms+1000 WHERE tenant='tenant-a'");
  if(scenario==='atomic-rollback'){await h.app.db.run("CREATE FUNCTION reject_command() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic rollback probe'; END $$");await h.app.db.run('CREATE TRIGGER reject_command BEFORE INSERT ON commands FOR EACH ROW EXECUTE FUNCTION reject_command()');}
  const results=await Promise.all(Array.from({length:20},()=>h.commit(p)));await h.app.engine.drain();
  if(scenario==='happy'){assert.ok(results.every(r=>r.status===200));assert.equal((await h.commit(p)).body.booking_state,'confirmed');assert.equal(h.stats().posts,1);assert.equal((await h.app.db.all('SELECT * FROM commands')).length,1);}
  else {assert.equal(h.stats().posts,0);assert.equal((await h.app.db.all('SELECT * FROM commands')).length,0);const row=await h.app.db.one('SELECT state FROM auto_proposals WHERE id=?',String(p.proposal_id));assert.notEqual(row?.state,'committed');if(scenario==='atomic-rollback'){assert.equal(row?.state,'authorized');await h.app.db.run('DROP TRIGGER reject_command ON commands');assert.equal((await h.commit(p)).status,200);await h.app.engine.drain();assert.equal(h.stats().posts,1);}}
 }finally{await h.close();const pool=new Pool({connectionString:process.env.POSTGRES_TEST_URL});try{await pool.query('DROP SCHEMA "'+schema+'" CASCADE');}finally{await pool.end();}}
});
