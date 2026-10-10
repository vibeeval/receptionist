PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS controls(tenant TEXT PRIMARY KEY, kill INTEGER NOT NULL DEFAULT 0 CHECK(kill IN(0,1)));
CREATE TABLE IF NOT EXISTS budgets(tenant TEXT PRIMARY KEY REFERENCES controls(tenant), cap INTEGER NOT NULL CHECK(cap>=0), reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0), spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0));
CREATE TABLE IF NOT EXISTS slots(tenant TEXT NOT NULL REFERENCES controls(tenant), id TEXT NOT NULL, resource TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL CHECK(end_ms>start_ms), service TEXT NOT NULL, PRIMARY KEY(tenant,id));
CREATE TABLE IF NOT EXISTS calls(tenant TEXT NOT NULL REFERENCES controls(tenant), id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('active','eligible','human','opted_out','ended')), last_event_ms INTEGER NOT NULL, started_ms INTEGER NOT NULL, PRIMARY KEY(tenant,id));
CREATE TABLE IF NOT EXISTS inbox(tenant TEXT NOT NULL REFERENCES controls(tenant), id TEXT NOT NULL, hash TEXT NOT NULL, safe_payload TEXT NOT NULL, created_ms INTEGER NOT NULL, PRIMARY KEY(tenant,id));
CREATE TABLE IF NOT EXISTS confirmations(tenant TEXT NOT NULL, id TEXT NOT NULL, call_id TEXT NOT NULL, slot_id TEXT NOT NULL, expires_ms INTEGER NOT NULL, evidence_hash TEXT NOT NULL, used_by TEXT, PRIMARY KEY(tenant,id), FOREIGN KEY(tenant,call_id) REFERENCES calls(tenant,id), FOREIGN KEY(tenant,slot_id) REFERENCES slots(tenant,id));
CREATE TABLE IF NOT EXISTS commands(tenant TEXT NOT NULL, id TEXT NOT NULL, hash TEXT NOT NULL, call_id TEXT NOT NULL, slot_id TEXT NOT NULL, confirmation_id TEXT NOT NULL, state TEXT NOT NULL CHECK(state IN('pending','attempted','unknown','confirmed','failed')), provider_receipt TEXT, provider_mock INTEGER NOT NULL DEFAULT 1 CHECK(provider_mock=1), cost INTEGER NOT NULL CHECK(cost>0), created_ms INTEGER NOT NULL, PRIMARY KEY(tenant,id), UNIQUE(tenant,confirmation_id), FOREIGN KEY(tenant,call_id) REFERENCES calls(tenant,id), FOREIGN KEY(tenant,slot_id) REFERENCES slots(tenant,id));
CREATE TABLE IF NOT EXISTS reservations(tenant TEXT NOT NULL, slot_id TEXT NOT NULL, command_id TEXT NOT NULL, resource TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, PRIMARY KEY(tenant,slot_id), UNIQUE(tenant,command_id), FOREIGN KEY(tenant,command_id) REFERENCES commands(tenant,id));
CREATE TABLE IF NOT EXISTS jobs(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL REFERENCES controls(tenant), kind TEXT NOT NULL CHECK(kind IN('event','booking','crm')), ref TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN('pending','leased','done','dlq')), attempts INTEGER NOT NULL DEFAULT 0, due_ms INTEGER NOT NULL, lease_until INTEGER, lease_token TEXT, UNIQUE(tenant,kind,ref));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY AUTOINCREMENT, tenant TEXT NOT NULL, action TEXT NOT NULL, ref_hash TEXT NOT NULL, at_ms INTEGER NOT NULL);
CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TRIGGER IF NOT EXISTS audit_no_delete BEFORE DELETE ON audit BEGIN SELECT RAISE(ABORT,'append_only'); END;
CREATE TABLE IF NOT EXISTS dlq(job_id INTEGER PRIMARY KEY REFERENCES jobs(id), tenant TEXT NOT NULL, reason TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'needs_operator', created_ms INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS human_tasks(tenant TEXT NOT NULL, call_id TEXT NOT NULL, reason TEXT NOT NULL, adapter TEXT NOT NULL DEFAULT 'FAKE_NO_TRANSFER', PRIMARY KEY(tenant,call_id));
CREATE TABLE IF NOT EXISTS rate_windows(tenant TEXT NOT NULL, window INTEGER NOT NULL, count INTEGER NOT NULL, PRIMARY KEY(tenant,window));
CREATE INDEX IF NOT EXISTS jobs_due ON jobs(state,due_ms,lease_until);
CREATE INDEX IF NOT EXISTS reservation_overlap ON reservations(tenant,resource,start_ms,end_ms);

CREATE TABLE IF NOT EXISTS cancellation_gates(tenant TEXT NOT NULL REFERENCES controls(tenant),call_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(tenant,call_id));
CREATE TABLE IF NOT EXISTS operator_operations(tenant TEXT NOT NULL REFERENCES controls(tenant),scope TEXT NOT NULL,operation_id TEXT NOT NULL,hash TEXT NOT NULL,result TEXT NOT NULL,PRIMARY KEY(tenant,scope,operation_id));
CREATE TABLE IF NOT EXISTS control_revisions(tenant TEXT PRIMARY KEY REFERENCES controls(tenant),revision INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS role_rate_windows(tenant TEXT NOT NULL,role TEXT NOT NULL,window INTEGER NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(tenant,role,window));

CREATE TABLE IF NOT EXISTS local_migrations(version TEXT PRIMARY KEY,applied_ms INTEGER NOT NULL);

CREATE TABLE IF NOT EXISTS booking_admission_gates(tenant TEXT NOT NULL,call_id TEXT NOT NULL,reason TEXT NOT NULL,PRIMARY KEY(tenant,call_id));
