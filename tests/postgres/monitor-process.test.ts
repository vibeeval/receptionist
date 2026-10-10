import test from 'node:test';import {harness} from './helpers.js';import {processLeaseCase} from '../monitor-lease-cases.js';
test('separate PG processes cannot steal live lease; expired takeover fences old owner',async()=>{const h=await harness();try{await processLeaseCase(h.engine.store,h.config,h.schema);}finally{await h.close();}});
