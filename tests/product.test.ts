import test from 'node:test';
import assert from 'node:assert/strict';
import { harness,signed,eligible,reserve,NOW } from './helpers.js';
test('fictional knowledge is versioned and slots are tenant scoped',async()=>{const h=harness();try{
 const kb=await signed(h.engine,h.config,'tool','demo-a','knowledge',undefined,{method:'GET'});assert.equal(kb.status,200);assert.equal(kb.body.fictional,true);assert.equal(kb.body.version,'demo-v1');
 const slots=await signed(h.engine,h.config,'tool','demo-a','slots',undefined,{method:'GET'});assert.equal(slots.status,200);assert.ok(Array.isArray(slots.body.slots));
 await eligible(h);await reserve(h);const after=await signed(h.engine,h.config,'tool','demo-a','slots',undefined,{method:'GET'});assert.ok(!(after.body.slots as {id:string}[]).some(s=>s.id==='slot-1'||s.id==='slot-overlap'));
}finally{h.close();}});
test('call duration bound rejects a late confirmation',async()=>{const h=harness();try{await eligible(h);h.setNow(NOW+301000);const r=await signed(h.engine,h.config,'operator','demo-a','confirmations',{callId:'call-1',slotId:'slot-1',attested:true,evidenceId:'x'},{timestamp:Math.floor((NOW+301000)/1000)});assert.equal(r.body.code,'CALL_EXPIRED');}finally{h.close();}});
test('acceptance failure never returns a successful ACK when database is unavailable',async()=>{const h=harness();try{h.engine.store.close();const r=await signed(h.engine,h.config,'event','demo-a','events',{});assert.equal(r.status,503);}finally{h.engine.provider.close();const {rmSync}=await import('node:fs');rmSync(h.dir,{recursive:true,force:true});}});
