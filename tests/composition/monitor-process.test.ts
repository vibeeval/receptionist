import test from 'node:test';import {fixture} from './fixture.js';import {processLeaseCase} from '../monitor-lease-cases.js';
test('separate SQLite processes cannot steal live lease; expired takeover fences old owner',async()=>{const h=await fixture();try{await processLeaseCase(h.app.db,h.config);}finally{await h.close();}});
