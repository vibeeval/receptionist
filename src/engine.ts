import type { AvailabilityPort } from './providers/google-availability.js';
import { SqliteAsyncStore, type AsyncStore } from './async-store.js';
import type { PgStore } from './pg-store.js';
import { randomUUID } from 'node:crypto';
import type { Config, Tenant } from './config.js';
import { loadConfig, assertSeparateDatabases } from './config.js';
import { Store, type Job, type Command } from './store.js';
import { FakeProvider, ProviderFault, SimulatedCrash } from './fake-provider.js';
import type { CalendarPort, CrmPort, Receipt } from './ports.js';
import { AppError, verify, digest, canonical } from './security.js';
import { parse, eventSchema, confirmationSchema, bookingSchema, controlSchema, type Event } from './contracts.js';
export type Request = {
    method: string;
    path: string;
    body: Buffer;
    headers: Record<string, string | undefined>;
};
export type Result = {
    status: number;
    body: Record<string, unknown>;
};
export class Engine<S extends Store | PgStore = Store> {
    private readonly db: AsyncStore;
    readonly config: Config;
    readonly store: S;
    private fakeProvider: FakeProvider | undefined;
    get provider():FakeProvider {if(!this.fakeProvider)throw new Error('FAKE_PROVIDER_NOT_SELECTED');return this.fakeProvider;}
    get providerMock(){return this.calendar.providerMock;}
    private readonly knowledge:Record<string,{name:string;policy:string;service:string}>;
    private readonly calendar: CalendarPort;
    private readonly crm: CrmPort;
    private readonly refreshSlots:(()=>Promise<void>)|undefined;
    private readonly availability:AvailabilityPort|undefined;
    private readonly admissionReady:(()=>Promise<boolean>)|undefined;
    private readonly reservationAuthorizer: ((tenant:string,callId:string,confirmation:string,transaction:AsyncStore)=>Promise<void>) | undefined;
    private readonly clock: () => number;
    private readonly log: (entry: object) => void;
    constructor(config: Config, options: {
        seedDemo?:boolean;
        clock?: () => number;
        log?: (entry: object) => void;
        store?: S;
        asyncStore?:AsyncStore;
        knowledge?: Record<string,{name:string;policy:string;service:string}>;
        calendar?: CalendarPort;
        crm?: CrmPort;
        availability?:AvailabilityPort;
        refreshSlots?:()=>Promise<void>;
        admissionReady?:()=>Promise<boolean>;
        reservationAuthorizer?: (tenant:string,callId:string,confirmation:string,transaction:AsyncStore)=>Promise<void>;
    } = {}) { this.refreshSlots=options.refreshSlots;this.availability=options.availability;this.admissionReady=options.admissionReady;this.reservationAuthorizer=options.reservationAuthorizer; this.knowledge=options.knowledge??{}; this.config = loadConfig(config); this.clock = options.clock ?? Date.now; this.log = options.log ?? (() => { }); this.store = (options.store ?? new Store(this.config,{seedDemo:options.seedDemo===true})) as S; this.db = options.asyncStore??(this.store instanceof Store ? new SqliteAsyncStore(this.store) : this.store); try {
        if(options.calendar){if(!options.crm)throw new Error('EXPLICIT_CRM_REQUIRED');this.calendar=options.calendar;this.crm=options.crm;return;}
        if(this.store instanceof Store&&this.store.one("SELECT name FROM sqlite_master WHERE name='composition_profile'")&&this.store.one('SELECT profile FROM composition_profile WHERE id=1'))throw new Error('EXPLICIT_COMPOSITION_REQUIRED');
        assertSeparateDatabases(this.config.dbPath, this.config.providerDbPath);
        this.fakeProvider = new FakeProvider(this.config.providerDbPath);
        try {
            assertSeparateDatabases(this.config.dbPath, this.config.providerDbPath);
        }
        catch (e) {
            this.provider.close();
            throw e;
        }
    }
    catch (e) {
        this.store.close();
        throw e;
    } this.calendar = this.provider; this.crm = this.provider; }
    async request(r: Request): Promise<Result> {
        const correlation = randomUUID();
        let tenant: Tenant | undefined;
        try {
            if (r.body.length > this.config.maxBodyBytes)
                throw new AppError(413, 'BODY_TOO_LARGE');
            const match = /^\/v1\/tenants\/([a-z0-9-]+)\/(events|confirmations|bookings(?:\/[A-Za-z0-9_-]{1,64})?|calls\/[A-Za-z0-9_-]{1,64}|control|knowledge|slots)$/.exec(r.path);
            if (!match)
                throw new AppError(404, 'NOT_FOUND');
            tenant = this.config.tenants.find(t => t.route === match[1]);
            if (!tenant)
                throw new AppError(404, 'NOT_FOUND');
            const suffix = match[2]!;
            const role = suffix === 'events' ? 'event' : suffix === 'confirmations' || suffix === 'control' ? 'operator' : 'tool';
            verify(tenant.keys[role], r.headers, r.method, r.path, r.body, this.clock(), this.config.maxAgeSeconds);
            if (role !== 'operator')
                await this.rateLimit(tenant, role);
            if (r.method === 'GET' && (suffix === 'knowledge' || suffix === 'slots')) {
                if (r.body.length)
                    throw new AppError(400, 'INVALID_PAYLOAD');
                if (suffix === 'knowledge' && this.knowledge[tenant.id])return {status:200,body:{...this.knowledge[tenant.id],timezone:'Europe/Istanbul',providerMock:this.providerMock,fictional:this.providerMock}};
                if (suffix === 'knowledge')
                    return { status: 200, body: { fictional: true, version: 'demo-v1', name: 'Kurgusal Bilgi Masası', timezone: 'Europe/Istanbul', service: 'fictional-information-session', policy: 'Sadece kurgusal bilgi görüşmesi. Fiyat, sağlık veya acil durum tavsiyesi yok. Bilinmeyen talep insana yönlenir.', providerMock: this.providerMock } };
                await this.refreshSlots?.();
                let slots = await this.db.all(`SELECT id,start_ms,end_ms,service FROM slots s WHERE tenant=? AND start_ms>? AND NOT EXISTS(SELECT 1 FROM reservations r WHERE r.tenant=s.tenant AND r.resource=s.resource AND r.start_ms<s.end_ms AND r.end_ms>s.start_ms) ORDER BY start_ms LIMIT 1000`, tenant.id, this.clock());
                if(this.admissionReady&&!await this.admissionReady())throw new AppError(503,'PROVIDER_NOT_READY');
                if(this.availability){const filtered=await this.availability.available(tenant.id,slots.map(s=>({...s,startMs:Number(s.start_ms),endMs:Number(s.end_ms)})));slots=filtered.map(({startMs,endMs,...s})=>s);}
                return { status: 200, body: { slots:slots.slice(0,2), timezone: 'Europe/Istanbul', fictional: this.providerMock, providerMock: this.providerMock } };
            }
            if (r.method === 'GET' && (suffix.startsWith('bookings/') || suffix.startsWith('calls/'))) {
                if (r.body.length)
                    throw new AppError(400, 'INVALID_PAYLOAD');
                const id = suffix.split('/')[1]!;
                const row = suffix.startsWith('bookings/') ? await this.db.command(tenant.id, id) : await this.db.call(tenant.id, id);
                if (!row)
                    throw new AppError(404, 'NOT_FOUND');
                return { status: 200, body: { id, state: row.state, providerMock: this.providerMock, ...(row.provider_receipt ? { bookingId: row.provider_receipt } : {}) } };
            }
            if (r.method !== 'POST' || suffix.includes('/'))
                throw new AppError(405, 'METHOD_NOT_ALLOWED');
            let body: unknown;
            try {
                body = JSON.parse(r.body.toString('utf8'));
            }
            catch {
                throw new AppError(400, 'INVALID_JSON');
            }
            if (suffix === 'events')
                return await this.ingest(tenant, parse(eventSchema, body));
            if (suffix === 'confirmations') {
                const input = parse(confirmationSchema, body);
                return await this.operatorOperation(tenant, 'confirmation:' + input.callId, input.evidenceId, input, async () => { await this.rateLimit(tenant!, 'operator'); return await this.confirm(tenant!, input); });
            }
            if (suffix === 'bookings')
                return await this.reserve(tenant, parse(bookingSchema, body));
            const control = parse(controlSchema, body);
            const operationId = control.operationId ?? digest(r.headers['x-timestamp'] + '\n' + r.method + '\n' + r.path + '\n' + r.body.toString('utf8'));
            return await this.operatorOperation(tenant, 'control', operationId, control, async () => {
                if (!control.kill)
                    await this.rateLimit(tenant!, 'operator');
                const revision = Number((await this.db.one('SELECT revision FROM control_revisions WHERE tenant=?', tenant!.id))?.revision ?? 0);
                if (!control.kill && await this.db.killed(tenant!.id) && (!control.operationId || control.expectedRevision !== revision))
                    throw new AppError(409, 'CONTROL_REVISION_REQUIRED');
                if (control.expectedRevision !== undefined && control.expectedRevision !== revision)
                    throw new AppError(409, 'CONTROL_REVISION_CONFLICT');
                await this.db.run('UPDATE controls SET kill=? WHERE tenant=?', control.kill ? 1 : 0, tenant!.id);
                await this.db.run('INSERT INTO control_revisions VALUES(?,?) ON CONFLICT(tenant) DO UPDATE SET revision=excluded.revision', tenant!.id, revision + 1);
                await this.db.audit(tenant!.id, control.kill ? 'KILL_ENABLED' : 'KILL_DISABLED', 'operator', this.clock());
                return { status: 200, body: { kill: control.kill, revision: revision + 1, providerMock: this.providerMock } };
            });
        }
        catch (e) {
            const error = e instanceof AppError ? e : new AppError(503, 'INTERNAL_UNAVAILABLE');
            this.log({ level: 'warn', code: error.code, correlation, tenant: tenant ? digest(tenant.id).slice(0, 12) : 'unresolved' });
            return { status: error.status, body: { code: error.code, correlation, providerMock: this.providerMock } };
        }
    }
    private async operatorOperation(tenant: Tenant, scope: string, id: string, input: unknown, action: () => Promise<Result>) {
        return await this.db.transaction(async () => {
            const hash = digest(canonical(input));
            const previous = await this.db.one('SELECT hash,result FROM operator_operations WHERE tenant=? AND scope=? AND operation_id=?', tenant.id, scope, id);
            if (previous) {
                if (previous.hash !== hash)
                    throw new AppError(409, 'OPERATOR_OPERATION_CONFLICT');
                return JSON.parse(String(previous.result)) as Result;
            }
            const result = await action();
            await this.db.run('INSERT INTO operator_operations VALUES(?,?,?,?,?)', tenant.id, scope, id, hash, JSON.stringify(result));
            return result;
        });
    }
    private async rateLimit(tenant: Tenant, role: string) {
        const window = Math.floor(this.clock() / 60000);
        const apply = async () => {
            await this.db.run('DELETE FROM role_rate_windows WHERE window<?', window - 1);
            const count = Number((await this.db.one('SELECT count FROM role_rate_windows WHERE tenant=? AND role=? AND window=?', tenant.id, role, window))?.count ?? 0);
            if (count >= this.config.maxRequestsPerMinute)
                throw new AppError(429, 'RATE_LIMIT');
            await this.db.run('INSERT INTO role_rate_windows VALUES(?,?,?,1) ON CONFLICT(tenant,role,window) DO UPDATE SET count=role_rate_windows.count+1', tenant.id, role, window);
        };
        if (role === 'operator')
            await apply();
        else
            await this.db.transaction(apply);
    }
    private async ingest(tenant: Tenant, event: Event) {
        if (Date.parse(event.occurredAt) > this.clock() + this.config.maxAgeSeconds * 1000)
            throw new AppError(400, 'FUTURE_EVENT');
        const hash = digest(canonical(event));
        const safe = { ...event, data: event.type === 'call.started' ? {} : event.data };
        return await this.db.transaction(async () => {
            const previous = await this.db.one('SELECT hash FROM inbox WHERE tenant=? AND id=?', tenant.id, event.id);
            if (previous) {
                if (previous.hash !== hash)
                    throw new AppError(409, 'EVENT_CONFLICT');
                return { status: 200, body: { received: true, duplicate: true, providerMock: this.providerMock } };
            }
            await this.db.run('INSERT INTO inbox VALUES(?,?,?,?,?)', tenant.id, event.id, hash, JSON.stringify(safe), this.clock());
            if (event.type === 'intent.detected' && (['opt_out', 'human', 'emergency', 'transfer'].includes(event.data.intent) || event.data.confidence < this.config.threshold)) {
                await this.db.run('INSERT OR IGNORE INTO cancellation_gates VALUES(?,?,?)', tenant.id, event.callId, event.data.intent);
                await this.db.audit(tenant.id, 'CALL_DISPATCH_BLOCKED', event.callId, this.clock());
            }
            await this.db.enqueue(tenant.id, 'event', event.id, this.clock());
            await this.db.audit(tenant.id, 'EVENT_ACCEPTED', event.id, this.clock());
            return { status: 200, body: { received: true, duplicate: false, providerMock: this.providerMock } };
        });
    }
    private async confirm(tenant: Tenant, input: {
        callId: string;
        slotId: string;
        attested: true;
        evidenceId: string;
    }) {
        {
            if (await this.blocked(tenant.id, input.callId))
                throw new AppError(409, 'CALL_BLOCKED');
            const call = await this.db.call(tenant.id, input.callId);
            if (!call)
                throw new AppError(404, 'NOT_FOUND');
            if (this.clock() - Number(call.started_ms) > this.config.maxCallDurationMs)
                throw new AppError(409, 'CALL_EXPIRED');
            if (call.state !== 'eligible')
                throw new AppError(409, 'CALL_NOT_ELIGIBLE');
            if (!await this.db.one('SELECT id FROM slots WHERE tenant=? AND id=?', tenant.id, input.slotId))
                throw new AppError(404, 'NOT_FOUND');
            if (await this.db.killed(tenant.id))
                throw new AppError(503, 'KILL_SWITCH');
            const id = randomUUID();
            await this.db.run('INSERT INTO confirmations(tenant,id,call_id,slot_id,expires_ms,evidence_hash) VALUES(?,?,?,?,?,?)', tenant.id, id, input.callId, input.slotId, this.clock() + this.config.confirmationTtlMs, digest(input.evidenceId));
            await this.db.audit(tenant.id, 'OPERATOR_ATTESTED_CONFIRMATION', id, this.clock());
            return { status: 201, body: { confirmationId: id, providerMock: this.providerMock } };
        }
    }
    private async reserve(tenant: Tenant, input: {
        commandId: string;
        callId: string;
        slotId: string;
        confirmationId: string;
    }) {
        const hash = digest(canonical(input));
        const prior=await this.db.command(tenant.id,input.commandId);
        let checkedSlotHash:string|undefined;
        if(!prior){
            if(this.admissionReady&&!await this.admissionReady())throw new AppError(503,'PROVIDER_NOT_READY');
            if(this.availability){const s=await this.db.one('SELECT * FROM slots WHERE tenant=? AND id=?',tenant.id,input.slotId);if(!s||!await this.availability.recheck(tenant.id,{startMs:Number(s.start_ms),endMs:Number(s.end_ms)}))throw new AppError(409,'CALENDAR_BUSY');checkedSlotHash=digest(canonical(s));}
        }
        return await this.db.transaction(async () => {
            const previous = await this.db.command(tenant.id, input.commandId);
            if (previous) {
                if (previous.hash !== hash)
                    throw new AppError(409, 'COMMAND_CONFLICT');
                return { status: 200, body: { commandId: input.commandId, state: previous.state, duplicate: true, providerMock: this.providerMock } };
            }
            if (await this.db.killed(tenant.id))
                throw new AppError(503, 'KILL_SWITCH');
            if (await this.blocked(tenant.id, input.callId))
                throw new AppError(409, 'CALL_BLOCKED');
            if(await this.db.one('SELECT call_id FROM booking_admission_gates WHERE tenant=? AND call_id=?',tenant.id,input.callId))throw new AppError(409,'SESSION_CLOSED');
            const call = await this.db.call(tenant.id, input.callId);
            if (!call)
                throw new AppError(404, 'NOT_FOUND');
            if (call.state !== 'eligible')
                throw new AppError(409, 'CALL_NOT_ELIGIBLE');
            if (this.clock() - Number(call.started_ms) > this.config.maxCallDurationMs)
                throw new AppError(409, 'CALL_EXPIRED');
            const c = await this.db.one('SELECT * FROM confirmations WHERE tenant=? AND id=?', tenant.id, input.confirmationId);
            if (!c || c.call_id !== input.callId || c.slot_id !== input.slotId || Number(c.expires_ms) <= this.clock() || c.used_by)
                throw new AppError(409, 'CONFIRMATION_REQUIRED');
            const slot = await this.db.one('SELECT * FROM slots WHERE tenant=? AND id=?', tenant.id, input.slotId);
            if (!slot)
                throw new AppError(404, 'NOT_FOUND');
            if(checkedSlotHash&&digest(canonical(slot))!==checkedSlotHash)throw new AppError(409,'SLOT_CHANGED');
            if (Number(slot.start_ms) <= this.clock())
                throw new AppError(409, 'SLOT_EXPIRED');
            if (await this.db.one('SELECT command_id FROM reservations WHERE tenant=? AND resource=? AND start_ms<? AND end_ms>?', tenant.id, slot.resource!, slot.end_ms!, slot.start_ms!))
                throw new AppError(409, 'SLOT_CONFLICT');
            const budget = await this.db.budget(tenant.id), cost = this.config.commandCostMicros;
            if (budget.reserved + budget.spent + cost > budget.cap)
                throw new AppError(429, 'BUDGET_LIMIT');
            if (Number((await this.db.one('SELECT count(*) n FROM commands WHERE tenant=?', tenant.id))?.n) >= tenant.maxCalls)
                throw new AppError(429, 'COMMAND_LIMIT');
            await this.reservationAuthorizer?.(tenant.id,input.callId,input.confirmationId,this.db);
            await this.db.run("INSERT INTO commands(tenant,id,hash,call_id,slot_id,confirmation_id,state,cost,created_ms,provider_mock) VALUES(?,?,?,?,?,?,'pending',?,?,?)", tenant.id, input.commandId, hash, input.callId, input.slotId, input.confirmationId, cost, this.clock(), this.providerMock?1:0);
            await this.db.run('INSERT INTO reservations VALUES(?,?,?,?,?,?)', tenant.id, input.slotId, input.commandId, slot.resource!, slot.start_ms!, slot.end_ms!);
            await this.db.run('UPDATE confirmations SET used_by=? WHERE tenant=? AND id=?', input.commandId, tenant.id, input.confirmationId);
            await this.db.run('UPDATE budgets SET reserved=reserved+? WHERE tenant=?', cost, tenant.id);
            await this.db.enqueue(tenant.id, 'booking', input.commandId, this.clock());
            await this.db.audit(tenant.id, 'COMMAND_RESERVED', input.commandId, this.clock());
            return { status: 202, body: { commandId: input.commandId, state: 'pending', providerMock: this.providerMock } };
        });
    }
    private async blocked(tenant: string, call: string) { return !!await this.db.one('SELECT 1 FROM cancellation_gates WHERE tenant=? AND call_id=?', tenant, call); }
    private async processEvent(job: Job) {
        await this.db.transaction(async () => {
            if (!await this.db.owns(job))
                return;
            const row = (await this.db.one('SELECT safe_payload,created_ms FROM inbox WHERE tenant=? AND id=?', job.tenant, job.ref))!;
            const e = JSON.parse(String(row.safe_payload)) as Event, at = Date.parse(e.occurredAt), previous = await this.db.call(job.tenant, e.callId);
            if (previous && (at < Number(previous.last_event_ms) || ['ended', 'opted_out'].includes(String(previous.state)))) {
                await this.db.done(job);
                return;
            }
            let state = previous ? String(previous.state) : 'active';
            let humanReason = '';
            if (e.type === 'call.ended')
                state = 'ended';
            if (e.type === 'intent.detected') {
                if (e.data.intent === 'opt_out')
                    state = 'opted_out';
                else if (['human', 'emergency', 'transfer'].includes(e.data.intent) || e.data.confidence < this.config.threshold || !previous) {
                    state = 'human';
                    humanReason = e.data.intent === 'emergency' ? 'EMERGENCY' : 'HUMAN_REQUIRED';
                }
                else if (e.data.intent === 'booking' && state !== 'human')
                    state = 'eligible';
            }
            await this.db.run('INSERT INTO calls VALUES(?,?,?,?,?) ON CONFLICT(tenant,id) DO UPDATE SET state=excluded.state,last_event_ms=excluded.last_event_ms', job.tenant, e.callId, state, at, Number(row.created_ms));
            if (state === 'human')
                await this.db.run('INSERT OR IGNORE INTO human_tasks(tenant,call_id,reason) VALUES(?,?,?)', job.tenant, e.callId, humanReason || 'REVIEW_REQUIRED');
            await this.db.audit(job.tenant, 'EVENT_PROCESSED', e.id, this.clock());
            await this.db.done(job);
        });
    }
    private async finishBooking(job: Job, command: Command, receipt: Receipt) {
        if(receipt.providerMock!==this.calendar.providerMock)throw new ProviderFault('unknown');
        await this.db.transaction(async () => {
            if (!await this.db.owns(job))
                return;
            const current = (await this.db.command(command.tenant, command.id))!;
            if (current.state !== 'confirmed') {
                await this.db.run("UPDATE commands SET state='confirmed',provider_receipt=? WHERE tenant=? AND id=?", receipt.id, command.tenant, command.id);
                await this.db.run('UPDATE budgets SET reserved=reserved-?,spent=spent+? WHERE tenant=?', command.cost, command.cost, command.tenant);
                await this.db.enqueue(command.tenant, 'crm', command.id, this.clock());
                await this.db.audit(command.tenant, this.providerMock?'FAKE_BOOKING_CONFIRMED':'BOOKING_CONFIRMED', command.id, this.clock());
            }
            await this.db.done(job);
        });
    }
    private async failure(job: Job, command: Command | undefined, kind: 'no_effect_retryable' | 'no_effect_terminal' | 'unknown') {
        await this.db.transaction(async () => {
            if (!await this.db.owns(job))
                return;
            const exhausted = job.attempts >= this.config.maxAttempts || kind === 'no_effect_terminal';
            if (command) {
                const state = kind === 'unknown' ? 'unknown' : exhausted ? 'failed' : 'pending';
                await this.db.run('UPDATE commands SET state=? WHERE tenant=? AND id=?', state, command.tenant, command.id);
                if (state === 'failed') {
                    await this.db.run('DELETE FROM reservations WHERE tenant=? AND command_id=?', command.tenant, command.id);
                    await this.db.run('UPDATE budgets SET reserved=reserved-? WHERE tenant=?', command.cost, command.tenant);
                }
            }
            if (exhausted) {
                await this.db.run("UPDATE jobs SET state='dlq',lease_token=NULL,lease_until=NULL WHERE id=?", job.id);
                await this.db.run('INSERT OR IGNORE INTO dlq(job_id,tenant,reason,created_ms) VALUES(?,?,?,?)', job.id, job.tenant, kind.toUpperCase(), this.clock());
            }
            else {
                const jitter = parseInt(digest(job.tenant + job.ref + job.attempts).slice(0, 4), 16) % 251;
                await this.db.run("UPDATE jobs SET state='pending',due_ms=?,lease_token=NULL,lease_until=NULL WHERE id=?", this.clock() + 1000 * 4 ** (job.attempts - 1) + jitter, job.id);
            }
            await this.db.audit(job.tenant, exhausted ? 'JOB_DLQ' : 'JOB_RETRY', job.ref, this.clock());
        });
    }
    async runOnce(): Promise<boolean> {
        const job = await this.db.claim(this.clock());
        if (!job)
            return false;
        if (job.kind === 'event') {
            await this.processEvent(job);
            return true;
        }
        const command = (await this.db.command(job.tenant, job.ref))!;
        if (job.kind === 'crm') {
            try {
                await this.crm.upsertCrm(command.tenant, command.id, command.provider_receipt!);
                await this.db.transaction(async () => { if (await this.db.owns(job)) {
                    await this.db.audit(job.tenant, this.crm.providerMock?'FAKE_CRM_SYNCED':this.crm.deliveryKind==='local'?'LOCAL_FOLLOWUP_RECORDED':this.crm.deliveryKind==='webhook'?'CRM_WEBHOOK_DELIVERED':'CRM_SYNC_COMPLETED', job.ref, this.clock());
                    await this.db.done(job);
                } });
            }
            catch {
                await this.failure(job, undefined, 'no_effect_retryable');
            }
            return true;
        }
        if (command.state === 'confirmed' || command.state === 'failed') {
            await this.db.done(job);
            return true;
        }
        if (command.state === 'unknown' || command.state === 'attempted') {
            try {
                const result = await this.calendar.lookup(command.tenant, command.id);
                if (result.status === 'confirmed')
                    await this.finishBooking(job, command, result.receipt);
                else
                    await this.failure(job, command, result.status === 'absent' ? 'no_effect_retryable' : 'unknown');
            }
            catch {
                await this.failure(job, command, 'unknown');
            }
            return true;
        }
        const canExecute = await this.db.transaction(async () => {
            if (!await this.db.owns(job))
                return false;
            if (await this.db.killed(job.tenant)) {
                await this.db.run("UPDATE jobs SET state='pending',lease_token=NULL,lease_until=NULL,attempts=attempts-1 WHERE id=?", job.id);
                return false;
            }
            const slot = await this.db.one('SELECT start_ms FROM slots WHERE tenant=? AND id=?', command.tenant, command.slot_id);
            if (!slot || Number(slot.start_ms) <= this.clock()) {
                await this.db.audit(command.tenant, 'PENDING_SLOT_EXPIRED', command.id, this.clock());
                return false;
            }
            if (await this.blocked(command.tenant, command.call_id))
                return false;
            if (['opted_out', 'human'].includes(String((await this.db.call(command.tenant, command.call_id))?.state)))
                return false;
            await this.db.run("UPDATE commands SET state='attempted' WHERE tenant=? AND id=?", command.tenant, command.id);
            await this.db.audit(command.tenant, 'PROVIDER_ATTEMPTED', command.id, this.clock());
            return true;
        });
        if (!canExecute) {
            if (await this.db.owns(job))
                await this.failure(job, command, 'no_effect_terminal');
            return true;
        }
        try {
            const receipt = await this.calendar.book(command.tenant, command.id, command.slot_id);
            await this.finishBooking(job, command, receipt);
        }
        catch (e) {
            if (e instanceof SimulatedCrash)
                throw e;
            await this.failure(job, command, e instanceof ProviderFault ? e.outcome : 'unknown');
        }
        return true;
    }
    async drain(limit = 1000) { let n = 0; while (n < limit && await this.runOnce())
        n++; return n; }
    close() { this.fakeProvider?.close(); return this.store.close(); }
}
