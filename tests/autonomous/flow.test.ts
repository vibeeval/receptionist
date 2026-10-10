import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FLOW,FLOW_DIGEST,AGENT_PATCH,NODES } from '../../src/autonomous/flow.js';
import { canonical,digest } from '../../src/security.js';
test('versioned SDK-typed flow matches export; exact readback uses Skip Response, DTMF enabled',()=>{
 const disk=JSON.parse(readFileSync('flows/autonomous-flow.v1.json','utf8'));assert.deepEqual(disk,FLOW);assert.equal(digest(canonical(disk)),FLOW_DIGEST);
 const readback=FLOW.nodes.find(n=>n.id===NODES.readback)!;assert.equal(readback.type,'conversation');if(readback.type!=='conversation')throw new Error('wrong node');assert.deepEqual(readback.instruction,{type:'static_text',text:'{{readback_text}}'});assert.equal(readback.skippable,false);assert.equal(readback.allow_dtmf_interruption,false);assert.equal(readback.skip_response_edge?.destination_node_id,NODES.wait);assert.equal(AGENT_PATCH.allow_user_dtmf,true);assert.equal(AGENT_PATCH.user_dtmf_options.digit_limit,1);
});
