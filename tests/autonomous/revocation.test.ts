import test from 'node:test';
import { setup } from './fixture.js';
import { revokeCases,checkRevocation } from './revoke-cases.js';
for(const mode of revokeCases)test('durable revocation and tool proof: '+mode,async()=>{const h=await setup();try{await checkRevocation(h,mode);}finally{await h.close();}});
