import { retentionTests } from '../retention-shared.js';
import { harness,pgEngine } from './helpers.js';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
retentionTests('PostgreSQL',async()=>{const h=await harness();let other:Awaited<ReturnType<typeof pgEngine>>|undefined;return {db:h.engine.store,close:async()=>{await other?.close();await h.close();},reopen:async()=>{await h.engine.store.close();other=await pgEngine(h.config);return other.store;},backupRestore:async()=>{const bin=process.env.POSTGRES_TEST_BIN;if(!bin)throw new Error('VERIFIED_POSTGRES_TEST_BIN_REQUIRED');const file=join(h.dir,'retention.dump');execFileSync(join(bin,'pg_dump'),['-Fc','-d','receptionist_test','-n',h.schema,'-f',file],{stdio:'pipe'});await h.engine.store.run('DROP SCHEMA "'+h.schema+'" CASCADE');execFileSync(join(bin,'pg_restore'),['--exit-on-error','-d','receptionist_test',file],{stdio:'pipe'});return h.engine.store;}};});
