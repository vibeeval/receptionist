import {oauthClientBinding} from '../src/providers/credentials.js';
import {readFileSync} from 'node:fs';
import {compositionSchema,coreFromReferences,environmentSecret} from '../src/composition-config.js';
import {Store} from '../src/store.js';import {PgStore} from '../src/pg-store.js';import {SqliteAsyncStore} from '../src/async-store.js';import {EncryptedCredentialStore} from '../src/providers/credential-db.js';
// Local replacement only: does not obtain a grant, call Google, or print credential values.
if(process.argv[2]!=='--replace-google-grant'||!process.env.CONFIG_JSON_PATH||!process.env.COMPOSITION_JSON_PATH)throw new Error('EXPLICIT_REPLACEMENT_AND_CONFIG_PATHS_REQUIRED');
const settings=compositionSchema.parse(JSON.parse(readFileSync(process.env.COMPOSITION_JSON_PATH,'utf8'))),config=coreFromReferences(JSON.parse(readFileSync(process.env.CONFIG_JSON_PATH,'utf8')),environmentSecret),oauth=settings.google.oauth;
if(!oauth)throw new Error('OAUTH_CONFIGURATION_REQUIRED');
const raw=settings.database.kind==='postgres'?await PgStore.open(config,environmentSecret(settings.database.urlRef),settings.database.schema,settings.database.mode):new Store(config),db=raw instanceof Store?new SqliteAsyncStore(raw):raw;
try{const store=new EncryptedCredentialStore(db,()=>environmentSecret(oauth.encryptionKeyRef));await store.migrate();await store.exclusive(async session=>{const old=await session.read();if(old?.state==='refresh_pending'&&old.pending!.until>Date.now())throw new Error('REFRESH_IN_PROGRESS_STOP_INSTANCES_AND_WAIT');await session.write({accessToken:'',refreshToken:environmentSecret(oauth.refreshTokenRef),expiresAt:0,generation:(old?.generation??0)+1,state:'ready',scopes:[settings.google.scope,...(settings.google.freeBusyScope?[settings.google.freeBusyScope]:[])],clientBinding:oauthClientBinding(environmentSecret(oauth.clientIdRef))});});console.log(JSON.stringify({credentialReplaced:true,externalRequests:0,restartRequired:true}));}finally{await raw.close();}
