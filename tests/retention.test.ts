import { retentionTests } from './retention-shared.js';
import { harness } from './helpers.js';
import { SqliteAsyncStore } from '../src/async-store.js';
import { Store } from '../src/store.js';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
retentionTests('SQLite',async()=>{const h=harness();let extra:Store|undefined;return {db:new SqliteAsyncStore(h.engine.store),close:async()=>{extra?.close();h.close();},reopen:async()=>{extra=new Store(h.config);return new SqliteAsyncStore(extra);},backupRestore:async()=>{const file=join(h.dir,'backup.sqlite');h.engine.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');copyFileSync(h.config.dbPath,file);h.engine.store.db.exec('PRAGMA wal_checkpoint(TRUNCATE)'); // restore into a separate opened database, preserving the source fixture
const restored=join(h.dir,'restored.sqlite');copyFileSync(file,restored);extra=new Store({...h.config,dbPath:restored});return new SqliteAsyncStore(extra);}};});
