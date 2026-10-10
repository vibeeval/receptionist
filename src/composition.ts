import { loadConfig } from './config.js';
import { materializeFlow } from './autonomous/flow.js';
import { ScheduleService } from './schedule.js';
import { GoogleAvailability } from './providers/google-availability.js';
import { RefreshingCredentialProvider,oauthClientBinding,type CredentialProvider,type CredentialStore } from './providers/credentials.js';
import { EncryptedCredentialStore } from './providers/credential-db.js';
import { SetupHealth,RetellSetupVerifier,type SetupVerifier } from './providers/retell-setup.js';
import { GenericWebhookCrm } from './providers/crm-webhook.js';
import { ProviderFault } from './fake-provider.js';
import { PgStore } from './pg-store.js';
import { AutonomousConfirmation } from './autonomous/controller.js';
import { RetellMonitorTransport,type MonitorTransport } from './autonomous/transport.js';
import { Engine } from './engine.js';
import type { Config } from './config.js';
import { Store } from './store.js';
import { SqliteAsyncStore,type AsyncStore } from './async-store.js';
import { compositionSchema,type SecretResolver } from './composition-config.js';
import { compositionMigration } from './composition-migration.js';
import { RetellGateway } from './providers/retell.js';
import { GoogleCalendarContractAdapter } from './providers/google-calendar.js';
import { GoogleHttpsTransport } from './providers/google-transport.js';
import { VoiceConfirmation } from './voice-confirmation.js';
import { AppError,digest,canonical } from './security.js';
export async function compose(config:Config,input:unknown,options:{resolve:SecretResolver;fetcher?:typeof fetch;clock?:()=>number;monitorTransport?:MonitorTransport;credentials?:CredentialProvider;credentialStore?:CredentialStore;setupVerifier?:SetupVerifier}){
 config=loadConfig(config);
 const parsed=compositionSchema.safeParse(input);if(!parsed.success)throw new Error('INVALID_COMPOSITION_CONFIG');const settings=parsed.data;
 if(settings.profile==='disabled'||settings.profile==='live'&&!settings.enableLive)throw new Error('LIVE_MODE_DISABLED');
 if(settings.profile==='test'&&typeof options.fetcher!=='function')throw new Error('INJECTED_TEST_TRANSPORT_REQUIRED');
 if(settings.autonomous&&settings.profile==='test'&&!options.monitorTransport)throw new Error('INJECTED_MONITOR_REQUIRED');
 if(settings.profile==='live'&&(!settings.google.oauth||!settings.google.availability||!settings.google.freeBusyScope||!settings.autonomous?.setup))throw new Error('PRODUCTION_SETUP_REQUIRED');
 if(settings.google.availability&&!settings.google.freeBusyScope)throw new Error('FREEBUSY_SCOPE_REQUIRED');
 if(settings.autonomous?.setup&&settings.accounts.some(a=>!settings.autonomous!.setup!.handoffNumbers[a.id]))throw new Error('HANDOFF_CONFIGURATION_REQUIRED');
 if(settings.profile==='live'&&config.leaseMs<30000)throw new Error('PRODUCTION_WORKER_LEASE_TOO_SHORT');
 const now=options.clock??Date.now,tenants=config.tenants.map(t=>t.id);
 if(config.tenants.some(t=>!settings.accounts.some(a=>a.tenantRoute===t.route)))throw new Error('INCOMPLETE_ACCOUNT_MAPPING');
 if(tenants.some(t=>!settings.google.calendars[t]||!settings.knowledge[t])||Object.keys(settings.google.calendars).some(t=>!tenants.includes(t))||settings.slots.some(s=>!tenants.includes(s.tenant)||s.endMs<=s.startMs)||new Set(settings.slots.map(s=>s.tenant+':'+s.id)).size!==settings.slots.length)throw new Error('INCOMPLETE_TRUSTED_MAPPING');
 if(settings.schedules?.some(s=>!tenants.includes(s.tenant)||s.endMinute-s.startMinute<s.durationMinutes))throw new Error('INVALID_SCHEDULE');
 if(!settings.slots.length&&!settings.schedules?.length)throw new Error('SCHEDULE_REQUIRED');
 const accounts=settings.accounts.map(a=>({id:a.id,key:options.resolve(a.keyRef),tenantRoute:a.tenantRoute,agentIds:a.agentIds}));
 RetellGateway.validate({config,request:async()=>{throw new Error('NOT_READY');}},accounts);
 if(new Set(Object.values(settings.google.calendars)).size!==Object.values(settings.google.calendars).length)throw new Error('DUPLICATE_CALENDAR_MAPPING');
 if(settings.autonomous)AutonomousConfirmation.validatePins(accounts,settings.autonomous.pins);
 if(settings.database.kind==='postgres'&&settings.database.mode==='production'&&settings.profile!=='live')throw new Error('PRODUCTION_DATABASE_REQUIRES_LIVE_PROFILE');
 // Pure configuration/adapter validation precedes opening any persistent store.
 const fetcher=options.fetcher??globalThis.fetch;
 if(typeof fetcher!=='function'||options.fetcher!==undefined&&typeof options.fetcher!=='function'||options.clock!==undefined&&typeof options.clock!=='function')throw new Error('INVALID_COMPOSITION_DEPENDENCY');
 if(options.monitorTransport!==undefined&&(!options.monitorTransport||typeof options.monitorTransport.connect!=='function')||options.setupVerifier!==undefined&&(!options.setupVerifier||typeof options.setupVerifier.check!=='function')||options.credentialStore!==undefined&&(!options.credentialStore||typeof options.credentialStore.exclusive!=='function'))throw new Error('INVALID_COMPOSITION_DEPENDENCY');
 if(options.credentials!==undefined&&(!options.credentials||['get','invalidate','readiness','close'].some(k=>typeof (options.credentials as unknown as Record<string,unknown>)[k]!=='function')))throw new Error('INVALID_COMPOSITION_DEPENDENCY');
 const initialTime=now();if(!Number.isSafeInteger(initialTime)||initialTime<0||initialTime>8640000000000000-31*86400000)throw new Error('INVALID_COMPOSITION_CLOCK');
 const externalCrm=settings.crm?.enabled?new GenericWebhookCrm(settings.crm.url,()=>options.resolve(settings.crm!.keyRef),settings.crm.allowedTargets,fetcher):undefined;
 externalCrm?.validateConfiguration();
 const setup=settings.autonomous?.setup;
 if(setup)for(const account of accounts){materializeFlow(setup.origin,account.id,setup.handoffNumbers[account.id]);if(account.agentIds.some(id=>!setup.remoteDigests[id]))throw new Error('REMOTE_FLOW_DIGEST_REQUIRED');}
 const validateSecret=(value:string)=>{if(!value||value.length>8192||value.startsWith('REPLACE_')||/[\r\n]/.test(value))throw new Error('GOOGLE_CREDENTIAL_REQUIRED');return value;};
 if(!options.credentials){if(settings.google.oauth){const o=settings.google.oauth;validateSecret(options.resolve(o.clientIdRef));validateSecret(options.resolve(o.clientSecretRef));if(!options.credentialStore&&!/^[a-fA-F0-9]{64}$/.test(options.resolve(o.encryptionKeyRef)))throw new Error('INVALID_CREDENTIAL_ENCRYPTION_KEY');}else{if(!settings.google.accessTokenRef)throw new Error('GOOGLE_CREDENTIAL_REQUIRED');validateSecret(options.resolve(settings.google.accessTokenRef));}}
 const setupHealth=setup?new SetupHealth(options.setupVerifier??new RetellSetupVerifier(accounts,settings.autonomous!.pins,setup.origin,setup.remoteDigests,setup.handoffNumbers,fetcher),now):undefined;
 const mappingHash=digest(canonical({accounts:settings.accounts,google:settings.google,slots:settings.slots,...(settings.schedules?{schedules:settings.schedules}:{}),knowledge:settings.knowledge,...(settings.crm?{crm:settings.crm}:{}),...(settings.autonomous?{autonomous:settings.autonomous}:{})}));
 const store=settings.database.kind==='postgres'?await PgStore.open(config,options.resolve(settings.database.urlRef),settings.database.schema,settings.database.mode,{deferTenantProvisioning:true}):new Store(config,{deferTenantProvisioning:true}),db:AsyncStore=store instanceof Store?new SqliteAsyncStore(store):store;let engine:Engine<Store|PgStore>|undefined;let autonomous:AutonomousConfirmation|undefined;let credentials:CredentialProvider|undefined=options.credentials;
 try{
  await compositionMigration(db,store instanceof Store?store:undefined);
  const existing=await db.one('SELECT * FROM composition_profile WHERE id=1');
  if(existing&&(existing.profile!==settings.profile||existing.mapping_hash!==mappingHash))throw new Error('COMPOSITION_MAPPING_CHANGE_REQUIRES_MIGRATION');
  if(!existing)for(const table of ['calls','commands','inbox'])if((await db.all('SELECT * FROM '+table)).length)throw new Error('FRESH_COMPOSITION_DATABASE_REQUIRED');
  if(setupHealth&&!await setupHealth.ready())throw new Error('PROVIDER_SETUP_NOT_READY');
  if(settings.google.oauth&&!credentials){
   const o=settings.google.oauth,credentialStore=options.credentialStore??new EncryptedCredentialStore(db,()=>options.resolve(o.encryptionKeyRef));
   if(credentialStore instanceof EncryptedCredentialStore)await credentialStore.migrate();
   // Resolve bootstrap grant only for an empty store; rotation remains authoritative thereafter.
   await credentialStore.exclusive(async session=>{const prior=await session.read();if(prior&&!prior.clientBinding)throw new Error('OAUTH_CLIENT_BINDING_REQUIRED');if(!prior)await session.write({accessToken:'',refreshToken:validateSecret(options.resolve(o.refreshTokenRef)),expiresAt:0,generation:0,state:'ready',scopes:[settings.google.scope,...(settings.google.freeBusyScope?[settings.google.freeBusyScope]:[])],clientBinding:oauthClientBinding(validateSecret(options.resolve(o.clientIdRef)))});});
   credentials=new RefreshingCredentialProvider({store:credentialStore,clientId:async()=>options.resolve(o.clientIdRef),clientSecret:async()=>options.resolve(o.clientSecretRef),fetcher:options.fetcher??fetch,clock:now,timeoutMs:3000,attempts:1,requiredScopes:[settings.google.scope,...(settings.google.freeBusyScope?[settings.google.freeBusyScope]:[])]});
  }
  const token=async()=>{if(credentials)return (await credentials.get()).accessToken;const ref=settings.google.accessTokenRef;if(!ref)throw new Error('GOOGLE_CREDENTIAL_REQUIRED');const t=options.resolve(ref);if(!t||t.startsWith('REPLACE_')||/[\r\n]/.test(t))throw new Error('GOOGLE_CREDENTIAL_REQUIRED');return t;};
  await token();
  const https=new GoogleHttpsTransport(credentials??token,options.fetcher??globalThis.fetch);
  const transport=settings.profile==='test'?{mode:'offline-contract-only' as const,request:https.request.bind(https)}:https;
  const availability=settings.google.availability?new GoogleAvailability(settings.google.calendars,credentials??token,options.fetcher??fetch,now):undefined;
  const ready=async()=>{try{await token();return (!credentials||(await credentials.readiness()).ready)&&(!setupHealth||await setupHealth.ready());}catch{return false;}};
  if(!await ready())throw new Error('PROVIDER_SETUP_NOT_READY');
  const schedule=settings.schedules?.length?new ScheduleService(db,settings.schedules,now):undefined;
  const baseCalendar=new GoogleCalendarContractAdapter(settings.google.calendars,async(tenant,command)=>{const c=await db.command(tenant,command);if(!c)return;const s=await db.one('SELECT * FROM reservations WHERE tenant=? AND command_id=?',tenant,command);if(!s)return;return {tenant,command,slot:c.slot_id,startMs:Number(s.start_ms),endMs:Number(s.end_ms)};},transport,settings.profile==='live'?8000:1000);
  const calendar={providerMock:baseCalendar.providerMock,lookup:baseCalendar.lookup.bind(baseCalendar),book:async(tenant:string,command:string,slot:string)=>{
   if(!await ready())throw new ProviderFault('no_effect_retryable');
   if(availability){const reservation=await db.one('SELECT * FROM reservations WHERE tenant=? AND command_id=?',tenant,command);if(!reservation)throw new ProviderFault('no_effect_terminal');let free:boolean;try{free=await availability.recheck(tenant,{startMs:Number(reservation.start_ms),endMs:Number(reservation.end_ms)});}catch{throw new ProviderFault('no_effect_retryable');}if(!free)throw new ProviderFault('no_effect_terminal');}
   return baseCalendar.book(tenant,command,slot);
  }};
  const localCrm={providerMock:false,deliveryKind:'local' as const,upsertCrm:async(tenant:string,command:string,receipt:string)=>{await db.run('INSERT OR IGNORE INTO local_followups VALUES(?,?,?)',tenant,command,receipt);}};
  const crm=externalCrm??localCrm;
  engine=new Engine(config,{store,asyncStore:db,clock:now,calendar,crm,...(availability?{availability}:{}),admissionReady:ready,...(schedule?{refreshSlots:()=>schedule.ensure()}:{}),knowledge:settings.knowledge,reservationAuthorizer:async(t:string,c:string,f:string,tx:AsyncStore)=>{if(settings.autonomous)return autonomous!.guardReservation(t,c,f,tx);const binding=await tx.one('SELECT * FROM confirmation_slot_bindings WHERE tenant=? AND confirmation_id=?',t,f);const slot=binding&&await tx.one('SELECT * FROM slots WHERE tenant=? AND id=?',t,binding.slot_id!);if(!binding||binding.call_id!==c||!slot||digest(canonical(slot))!==binding.slot_hash)throw new AppError(409,'PROPOSAL_CHANGED');}});
  const gateway=await RetellGateway.open(engine,db,accounts,now),voice=new VoiceConfirmation(engine,db,gateway,now);
  if(settings.autonomous)autonomous=await AutonomousConfirmation.open(engine,db,accounts,settings.autonomous.pins,options.monitorTransport??new RetellMonitorTransport(),now,settings.profile==='live'?async()=>{const r=await db.one(store instanceof PgStore?'SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp())*1000) AS ms':"SELECT CAST((julianday('now')-2440587.5)*86400000 AS INTEGER) AS ms");return Number(r!.ms);}:undefined);
  await db.transaction(async()=>{const profile=settings.profile,hash=mappingHash,old=await db.one('SELECT * FROM composition_profile WHERE id=1');
   if(old&&(old.profile!==profile||old.mapping_hash!==hash))throw new Error('COMPOSITION_MAPPING_CHANGE_REQUIRES_MIGRATION');
   await store.provisionTenants();
   if(!old){for(const table of ['calls','commands','inbox'])if((await db.all('SELECT * FROM '+table)).length)throw new Error('FRESH_COMPOSITION_DATABASE_REQUIRED');await db.run('DELETE FROM slots');for(const s of settings.slots)await db.run('INSERT INTO slots VALUES(?,?,?,?,?,?)',s.tenant,s.id,s.resource,s.startMs,s.endMs,s.service);await db.run('INSERT INTO composition_profile VALUES(1,?,?)',profile,hash);}
   for(const row of await db.all('SELECT * FROM slots')){
    const expected=settings.slots.find(s=>s.tenant===row.tenant&&s.id===row.id);
    if(expected){if(row.resource!==expected.resource||Number(row.start_ms)!==expected.startMs||Number(row.end_ms)!==expected.endMs||row.service!==expected.service)throw new Error('CONFIGURED_SLOT_DRIFT');}
    else if(settings.schedules?.length&&row.id?.toString().startsWith('sched_')&&await db.one('SELECT id FROM schedule_slots WHERE tenant=? AND id=?',row.tenant!,row.id!))continue;
    else throw new Error('UNEXPECTED_COMPOSITION_SLOT');
   }
   await schedule?.ensure(db);
  });
  const router={config,providerMock:calendar.providerMock,request:async(r:Parameters<Engine['request']>[0])=>{if(autonomous&&r.path.endsWith('/autonomous'))return autonomous.handle(r);if(r.path.startsWith('/providers/retell/')){const result=await gateway.handle(r);if(autonomous&&result.status===200&&r.path.endsWith('/events'))await autonomous.lifecycle(r).catch(()=>{});return result;}return r.path.includes('/voice-confirmations/')?voice.handle(r):engine!.request(r);}};
  return {engine,db,gateway,voice,autonomous,router,profile:settings.profile,ready,close:async()=>{setupHealth?.close();const credentialClosing=credentials?.close();await autonomous?.close();await credentialClosing;await engine!.close();}};
 }catch(e){setupHealth?.close();const credentialClosing=credentials?.close();await autonomous?.close();await credentialClosing;if(engine)await engine.close();else await store.close();throw e;}
}
