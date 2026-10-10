import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { verifyRetell } from '../../src/providers/retell.js';
const key='synthetic-retell-webhook-test-key-only-123';
function signature(body:string,at=Date.now()){return `v=${at},d=${createHmac('sha256',key).update(body+at).digest('hex')}`;}
test('official Retell SDK verifies independent raw-body HMAC fixture with no fetch',async()=>{const old=globalThis.fetch;globalThis.fetch=async()=>{throw new Error('NETWORK_FORBIDDEN');};try{const body=' {"event":"call_started"}';await verifyRetell(Buffer.from(body),signature(body),key);await assert.rejects(()=>verifyRetell(Buffer.from(body.trim()),signature(body),key));}finally{globalThis.fetch=old;}});
for(const [name,offset]of [['stale',-301000],['future',301000]]as const)test('rejects '+name+' signature',async()=>{const body='{}';await assert.rejects(()=>verifyRetell(Buffer.from(body),signature(body,Date.now()+offset),key));});
test('missing malformed wrong-key and invalid UTF8 fail closed',async()=>{for(const sig of [undefined,'','v=1,d=x',signature('{}')+'junk'])await assert.rejects(()=>verifyRetell(Buffer.from('{}'),sig,key));await assert.rejects(()=>verifyRetell(Buffer.from('{}'),signature('{}'),key+'wrong'));await assert.rejects(()=>verifyRetell(Buffer.from([0xff]),signature('�'),key));});
