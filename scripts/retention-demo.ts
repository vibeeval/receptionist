// Creates its own disposable, synthetic fixture. Never accepts a database path or real data.
import { harness,signed,event,NOW } from '../tests/helpers.js';
import { SqliteAsyncStore } from '../src/async-store.js';
import { migrateRetell } from '../src/providers/retell-migration.js';
import { initializeSyntheticRetention,retentionRun } from '../src/retention.js';
import { randomBytes } from 'node:crypto';
const h=harness(),db=new SqliteAsyncStore(h.engine.store),fixtureToken=randomBytes(32).toString('hex');
try{await migrateRetell(db);await initializeSyntheticRetention(db,fixtureToken,NOW);
 await signed(h.engine,h.config,'event','demo-a','events',event());await h.engine.drain();
 await signed(h.engine,h.config,'event','demo-a','events',event('end','call-1','call.ended'));await h.engine.drain();
 await db.run('UPDATE inbox SET created_ms=?',NOW-2*86400000);
 const dry=await retentionRun(db,{fixtureToken,now:NOW,referenceNow:NOW});
 const applied=await retentionRun(db,{fixtureToken,now:NOW,referenceNow:NOW,apply:true});
 const replay=await signed(h.engine,h.config,'event','demo-a','events',event());
 if(replay.status!==200||applied.payloads!==2)throw new Error('SYNTHETIC_RETENTION_DEMO_FAILED');
 console.log(JSON.stringify({mode:'DISPOSABLE_SYNTHETIC_FIXTURE',dry,applied,replayStatus:replay.status,externalCalls:0,cleanup:'finally removes fixture directory'},null,2));
}finally{h.close();}
