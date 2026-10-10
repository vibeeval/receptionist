# Dashboard API handoff

Origin: http://127.0.0.1:8788 (ADMIN_PORT configurable). No external frontend/CDN. Fetch same-origin credentials. `/` serves index; `/app.js`, `/style.css` explicit allowlist. CSP allows self script/style/connect only, no inline script/style or external fonts. UI must not use localStorage for auth/secrets or innerHTML with response data.

## Session

- POST `/api/login`: `{username,password}`. Exact Origin + application/json; success sets HttpOnly SameSite=Strict cookie. No raw token response. Demo admin/operator/viewer password `demo-local-only-2026` is public dummy data only.
- GET `/api/session`: `{username,csrf,tenants:[{id,role}],demo}`. Roles admin/operator/viewer. Keep CSRF in memory.
- POST `/api/logout`: `{}` and X-CSRF-Token. Revokes session.
- All POSTs require exact Origin and Content-Type application/json; authenticated POST additionally X-CSRF-Token. All API responses JSON, no-store. Errors `{code,requestId}`; never render raw stack or request body. 401 means clear UI and login; 403 permission/CSRF; 409 stale revision; 429 rate limit.

## Tenant scope

`/api/tenants/{tenantId}/...`; tenant ID must be in session response. Never trust browser role for authorization; server enforces it. All GETs available to authorized tenant roles. Data lists capped at100.

- GET `overview`: `{calls,bookings,confirmed,errors,budget:{tenant,cap,reserved,spent},limitRevision,kill,revision,maxCalls,ready,providerMock,demo,providerInvoice:null,providerInvoiceReason:'NOT_CONNECTED',costUnit:'core_reservation_micros',observedAt}`. Numbers are persisted core records, not provider billing. ready is local health only. maxCalls is readonly config.
- GET `calls`: `{items:[{id,state,started_ms,last_event_ms}],limit:100}`.
- GET `bookings`: `{items:[{id,call_id,state,created_ms,provider_mock,start_ms,end_ms,service}],limit:100}`.
- GET `errors`: `{items:[{job_id,reason,state,created_ms,kind,attempts}],replayAvailable:false}`. No replay action.
- GET `audit`: `{items:[{id,action,at_ms}],admin:[{id,actor,action,at_ms}]}`. actor is hashed username, not real identity.
- GET `business`: `{draft:{value,revision,updated,active:false},effective:null,activationAvailable:false}` (effective may be supplied by server). Default draft value null. POST admin only: `{revision,value:{name,service,policy,timezone:'Europe/Istanbul',weekdays:[1..7],startMinute,endMinute,durationMinutes}}`. Hours valid and duration fits. Saves draft only; returns updated draft. Never claim it changes active slots/flow.
- GET `connections`: `{items:[{kind,stored,updated,verified:false,active:false}],runtimeProviderMock,activationAvailable:false,liveVerificationAvailable:false}`. Kinds retellApiKey/googleClientId/googleClientSecret/googleRefreshToken. POST admin only: `{kind,value}`; success `{stored:true,verified:false,active:false}`. Password input, clear on submission, do not re-populate. Value stays encrypted in server staging vault, no provider call or runtime activation.
- POST `control`: admin/operator only `{kill:boolean,revision:number,operationId:UUID}`. revision is overview.revision, a new UUID for each deliberate action (reuse exact UUID only for uncertain retry of same action). Calls existing core operator revision contract. Never auto-retry stale unkill. Success `{kill,revision,providerMock}`. Doesn't stop an existing phone call or provider charge.
- POST `limits`: admin only `{cap:integer 0..1e9,revision:overview.limitRevision}`; success `{cap,revision,providerHardCap:false}`. Atomic core DB cap + audit + persisted override. Only local booking budget; not Retell USD cap. Override reapplies only when dashboard enabled at startup. No maxCalls editing endpoint.

## Ownership during split

Sol frontend: `public/dashboard/index.html`, `public/dashboard/style.css`, `public/dashboard/app.js`. Astra backend: `src/admin/**`, `src/serve.ts`, `scripts/dashboard-demo.ts`, `tests/admin/**`, backend docs. Coordinate package/manifest changes; do not edit same files concurrently. Existing UI is functional scaffold, not visually accepted. Mac locked: browser/mobile/keyboard QA NOT_RUN.
