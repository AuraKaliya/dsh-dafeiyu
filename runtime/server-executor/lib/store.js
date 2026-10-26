import { DatabaseSync } from 'node:sqlite';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { configureSqlite } from '#dafeiyu/journal';
import { ExecutorIdentitySchema, ExecutorJobSpecSchema, ExecutorOperationBindingSchema, ExecutorProcessSchema, ExecutorHandshakeSchema, ExecutorStateSchema, ExecutorTerminalSchema, ExecutorReceiptSchema, ExecutorEventSchema, ExecutorHashSchema, ExecutorCodeSchema, ExecutorTaskScopeSchema, executorHash } from './types.js';
export const EXECUTOR_APPLICATION_ID = 0x44465831;
export const EXECUTOR_SCHEMA_VERSION = 1;
const active = ['prepared', 'launching', 'running'];
const immutable = ['executor_metadata', 'executor_job_operations', 'executor_events', 'executor_receipts'];
const clockSchema = z.number().int().nonnegative().max(8640000000000000);
function check(value, code) { if (!value)
    throw new Error(code); }
/** Trusted persistence only. A job description or a copied authorization hash never authorizes dispatch. */
export class ExecutorStore {
    db;
    closed = false;
    identity;
    constructor(file, identity, create = false) {
        this.identity = Object.freeze(ExecutorIdentitySchema.parse(identity));
        if (!existsSync(file) && !create)
            throw new Error('EXECUTOR_MIGRATION_REQUIRED');
        if (create)
            mkdirSync(dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        try {
            const version = Number(this.db.prepare('PRAGMA user_version').get()?.user_version), application = Number(this.db.prepare('PRAGMA application_id').get()?.application_id), empty = Number(this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n) === 0;
            if (version === 0 && application === 0 && empty && create) {
                configureSqlite(this.db);
                this.transaction(() => this.initialize());
            }
            else if (version !== EXECUTOR_SCHEMA_VERSION || application !== EXECUTOR_APPLICATION_ID)
                throw new Error('EXECUTOR_SCHEMA_UNSUPPORTED');
            const row = this.db.prepare('SELECT body,body_hash FROM executor_metadata WHERE id=1').get();
            check(row && row.body_hash === executorHash(this.identity) && executorHash(JSON.parse(String(row.body))) === row.body_hash, 'EXECUTOR_IDENTITY_MISMATCH');
            this.verifySchema();
            configureSqlite(this.db);
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    initialize() {
        this.db.exec(`
      CREATE TABLE executor_metadata(id INTEGER PRIMARY KEY CHECK(id=1),body TEXT NOT NULL,body_hash TEXT NOT NULL);
      CREATE TABLE executor_clock(id INTEGER PRIMARY KEY CHECK(id=1),last_seen INTEGER NOT NULL);
      INSERT INTO executor_clock VALUES(1,0);
      CREATE TABLE executor_jobs(id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,intent_version INTEGER NOT NULL,request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,
        nonce_hash TEXT UNIQUE,process TEXT,cancel_requested INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,
        UNIQUE(scope_key,intent_version,request_id));
      CREATE TABLE executor_job_operations(operation_id TEXT PRIMARY KEY,job_id TEXT NOT NULL REFERENCES executor_jobs(id),run_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL);
      CREATE TABLE executor_events(seq INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,job_id TEXT NOT NULL REFERENCES executor_jobs(id),
        version INTEGER NOT NULL,type TEXT NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(job_id,version));
      CREATE TABLE executor_receipts(id TEXT PRIMARY KEY,job_id TEXT UNIQUE NOT NULL REFERENCES executor_jobs(id),body TEXT NOT NULL,body_hash TEXT NOT NULL);
      CREATE TABLE executor_budget_links(job_id TEXT NOT NULL REFERENCES executor_jobs(id),call_id TEXT NOT NULL,reservation_id TEXT UNIQUE NOT NULL,
        request_hash TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('reserved','settled','unknown')),settlement_hash TEXT,PRIMARY KEY(job_id,call_id));
      CREATE INDEX executor_jobs_state ON executor_jobs(state);
      CREATE TRIGGER executor_job_identity_immutable BEFORE UPDATE OF id,scope_key,intent_version,request_id,fingerprint,body,body_hash,created_at ON executor_jobs
        BEGIN SELECT RAISE(ABORT,'Immutable executor job identity');END;
      CREATE TRIGGER executor_jobs_retain BEFORE DELETE ON executor_jobs BEGIN SELECT RAISE(ABORT,'Retain executor jobs');END;
      CREATE TRIGGER executor_budget_identity_immutable BEFORE UPDATE OF job_id,call_id,reservation_id,request_hash ON executor_budget_links
        BEGIN SELECT RAISE(ABORT,'Immutable parent budget link');END;
      CREATE TRIGGER executor_budget_links_retain BEFORE DELETE ON executor_budget_links BEGIN SELECT RAISE(ABORT,'Retain parent budget links');END;
      PRAGMA application_id=${EXECUTOR_APPLICATION_ID};PRAGMA user_version=${EXECUTOR_SCHEMA_VERSION};
    `);
        for (const table of immutable)
            this.db.exec(`CREATE TRIGGER ${table}_immutable BEFORE UPDATE ON ${table} BEGIN SELECT RAISE(ABORT,'Immutable executor evidence');END;
      CREATE TRIGGER ${table}_retain BEFORE DELETE ON ${table} BEGIN SELECT RAISE(ABORT,'Retain executor evidence');END;`);
        this.db.prepare('INSERT INTO executor_metadata VALUES(1,?,?)').run(JSON.stringify(this.identity), executorHash(this.identity));
    }
    verifySchema() {
        for (const [table, columns] of Object.entries({ executor_jobs: 'id,scope_key,intent_version,request_id,fingerprint,body,body_hash,state,version,nonce_hash,process,cancel_requested,created_at,updated_at',
            executor_job_operations: 'operation_id,job_id,run_id,fingerprint,body,body_hash', executor_events: 'seq,id,job_id,version,type,body,body_hash', executor_receipts: 'id,job_id,body,body_hash',
            executor_budget_links: 'job_id,call_id,reservation_id,request_hash,state,settlement_hash', executor_clock: 'id,last_seen' }))
            this.db.prepare(`SELECT ${columns} FROM ${table} LIMIT 0`).all();
        for (const trigger of ['executor_job_identity_immutable', 'executor_jobs_retain', 'executor_budget_identity_immutable', 'executor_budget_links_retain', ...immutable.flatMap(table => [table + '_immutable', table + '_retain'])])
            check(this.db.prepare('SELECT 1 FROM sqlite_master WHERE type=\'trigger\' AND name=?').get(trigger), 'EXECUTOR_SCHEMA_UNSUPPORTED');
    }
    transaction(work) { check(!this.closed, 'EXECUTOR_CLOSED'); this.db.exec('BEGIN IMMEDIATE'); try {
        const result = work();
        this.db.exec('COMMIT');
        return result;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    time(now) { clockSchema.parse(now); const last = Number(this.db.prepare('SELECT last_seen FROM executor_clock WHERE id=1').get()?.last_seen), next = Math.max(now, last); this.db.prepare('UPDATE executor_clock SET last_seen=? WHERE id=1').run(next); return new Date(next).toISOString(); }
    scope(raw) { const scope = ExecutorTaskScopeSchema.parse(raw); check(scope.agentId === this.identity.agentId, 'EXECUTOR_SCOPE_DENIED'); return scope; }
    append(raw) { const event = ExecutorEventSchema.parse(raw); this.db.prepare('INSERT INTO executor_events(id,job_id,version,type,body,body_hash) VALUES(?,?,?,?,?,?)').run(event.id, event.jobId, event.version, event.type, JSON.stringify(event), executorHash(event)); }
    operation(job, binding) {
        const old = this.db.prepare('SELECT job_id,body,body_hash,fingerprint FROM executor_job_operations WHERE operation_id=?').get(binding.operationId);
        if (old) {
            check(old.job_id === job.id && old.fingerprint === job.hash && old.body_hash === executorHash(binding) && executorHash(JSON.parse(String(old.body))) === old.body_hash, 'EXECUTOR_OPERATION_CONFLICT');
            return;
        }
        this.db.prepare('INSERT INTO executor_job_operations VALUES(?,?,?,?,?,?)').run(binding.operationId, job.id, binding.runId, job.hash, JSON.stringify(binding), executorHash(binding));
    }
    receipt(jobId) {
        const row = this.db.prepare('SELECT id,body,body_hash FROM executor_receipts WHERE job_id=?').get(jobId);
        if (!row)
            return null;
        const body = ExecutorReceiptSchema.parse(JSON.parse(String(row.body)));
        check(body.id === row.id && body.jobId === jobId && executorHash(body) === row.body_hash, 'EXECUTOR_EVIDENCE_CHANGED');
        return body;
    }
    get(id, rawScope) {
        check(!this.closed, 'EXECUTOR_CLOSED');
        const scope = this.scope(rawScope), row = this.db.prepare('SELECT * FROM executor_jobs WHERE id=? AND scope_key=?').get(z.uuid().parse(id), scope.scopeKey);
        check(row, 'EXECUTOR_SCOPE_DENIED');
        const spec = ExecutorJobSpecSchema.parse(JSON.parse(String(row.body))), hash = executorHash(spec);
        check(hash === row.body_hash && hash === row.fingerprint && executorHash(spec.scope) === executorHash(scope) && spec.intentVersion === row.intent_version && spec.requestId === row.request_id, 'EXECUTOR_EVIDENCE_CHANGED');
        const state = ExecutorStateSchema.parse(row.state), version = z.number().int().positive().parse(row.version), nonceHash = row.nonce_hash === null ? null : ExecutorHashSchema.parse(row.nonce_hash), process = row.process === null ? null : ExecutorProcessSchema.parse(JSON.parse(String(row.process))), receipt = this.receipt(id);
        const tail = this.db.prepare('SELECT body,body_hash FROM executor_events WHERE job_id=? ORDER BY version DESC LIMIT 1').get(id);
        check(tail, 'EXECUTOR_EVIDENCE_CHANGED');
        const event = ExecutorEventSchema.parse(JSON.parse(String(tail.body)));
        check(executorHash(event) === tail.body_hash && event.jobId === id && event.version === version, 'EXECUTOR_EVIDENCE_CHANGED');
        if (receipt)
            check(event.type === 'terminal' && event.receipt.id === receipt.id && event.receipt.hash === executorHash(receipt) && state === receipt.state && nonceHash === receipt.nonceHash && executorHash(process) === executorHash(receipt.process), 'EXECUTOR_EVIDENCE_CHANGED');
        else {
            let principal = event;
            if (event.type === 'cancel-requested') {
                check(row.cancel_requested === 1, 'EXECUTOR_EVIDENCE_CHANGED');
                const prior = this.db.prepare("SELECT body,body_hash FROM executor_events WHERE job_id=? AND type<>'cancel-requested' ORDER BY version DESC LIMIT 1").get(id);
                check(prior, 'EXECUTOR_EVIDENCE_CHANGED');
                principal = ExecutorEventSchema.parse(JSON.parse(String(prior.body)));
                check(executorHash(principal) === prior.body_hash && principal.jobId === id, 'EXECUTOR_EVIDENCE_CHANGED');
            }
            check(active.some(value => value === state) && principal.type === state, 'EXECUTOR_EVIDENCE_CHANGED');
            if (principal.type === 'launching')
                check(principal.nonceHash === nonceHash && process === null, 'EXECUTOR_EVIDENCE_CHANGED');
            if (principal.type === 'running')
                check(principal.handshake.nonceHash === nonceHash && principal.handshake.profileHash === spec.profileHash && executorHash(principal.handshake.process) === executorHash(process), 'EXECUTOR_EVIDENCE_CHANGED');
        }
        check(state !== 'prepared' || nonceHash === null && process === null, 'EXECUTOR_EVIDENCE_CHANGED');
        check(state !== 'running' || nonceHash !== null && process !== null, 'EXECUTOR_EVIDENCE_CHANGED');
        return { id, spec, hash, state, version, nonceHash, process, cancelRequested: row.cancel_requested === 1, createdAt: z.iso.datetime().parse(row.created_at), updatedAt: z.iso.datetime().parse(row.updated_at), receipt };
    }
    list(scope) { const bound = this.scope(scope); return this.db.prepare('SELECT id FROM executor_jobs WHERE scope_key=? ORDER BY rowid').all(bound.scopeKey).map(row => this.get(String(row.id), bound)); }
    events(id, scope) {
        this.get(id, scope);
        return this.db.prepare('SELECT id,version,type,body,body_hash FROM executor_events WHERE job_id=? ORDER BY seq').all(id).map(row => {
            const event = ExecutorEventSchema.parse(JSON.parse(String(row.body)));
            check(event.id === row.id && event.jobId === id && event.version === row.version && event.type === row.type && executorHash(event) === row.body_hash, 'EXECUTOR_EVIDENCE_CHANGED');
            return event;
        });
    }
    operations(id, scope) {
        const job = this.get(id, scope);
        return this.db.prepare('SELECT * FROM executor_job_operations WHERE job_id=? ORDER BY rowid').all(id).map(row => {
            const binding = ExecutorOperationBindingSchema.parse(JSON.parse(String(row.body)));
            check(binding.operationId === row.operation_id && binding.runId === row.run_id && row.fingerprint === job.hash && executorHash(binding) === row.body_hash, 'EXECUTOR_EVIDENCE_CHANGED');
            return binding;
        });
    }
    linkBudget(id, scope, input) {
        const value = z.strictObject({ callId: z.uuid(), reservationId: z.uuid(), requestHash: ExecutorHashSchema }).parse(input);
        this.transaction(() => {
            const job = this.get(id, scope), old = this.db.prepare('SELECT reservation_id,request_hash FROM executor_budget_links WHERE job_id=? AND call_id=?').get(id, value.callId);
            if (old) {
                check(old.reservation_id === value.reservationId && old.request_hash === value.requestHash, 'EXECUTOR_BUDGET_CONFLICT');
                return;
            }
            check(job.state === 'running' && !job.receipt, 'EXECUTOR_BUDGET_STATE');
            this.db.prepare("INSERT INTO executor_budget_links(job_id,call_id,reservation_id,request_hash,state) VALUES(?,?,?,?,'reserved')").run(id, value.callId, value.reservationId, value.requestHash);
        });
    }
    settleBudget(id, scope, input) {
        const value = z.strictObject({ callId: z.uuid(), reservationId: z.uuid(), state: z.enum(['settled', 'unknown']), settlementHash: ExecutorHashSchema }).parse(input);
        this.transaction(() => {
            this.get(id, scope);
            const old = this.db.prepare('SELECT reservation_id,state,settlement_hash FROM executor_budget_links WHERE job_id=? AND call_id=?').get(id, value.callId);
            check(old && old.reservation_id === value.reservationId, 'EXECUTOR_BUDGET_CONFLICT');
            if (old.state !== 'reserved') {
                check(old.state === value.state && old.settlement_hash === value.settlementHash, 'EXECUTOR_BUDGET_CONFLICT');
                return;
            }
            this.db.prepare('UPDATE executor_budget_links SET state=?,settlement_hash=? WHERE job_id=? AND call_id=?').run(value.state, value.settlementHash, id, value.callId);
        });
    }
    budgetLinks(id, scope) {
        this.get(id, scope);
        return this.db.prepare('SELECT call_id,reservation_id,request_hash,state,settlement_hash FROM executor_budget_links WHERE job_id=? ORDER BY rowid').all(id).map(row => z.strictObject({ callId: z.uuid(), reservationId: z.uuid(), requestHash: ExecutorHashSchema, state: z.enum(['reserved', 'settled', 'unknown']), settlementHash: ExecutorHashSchema.nullable() })
            .parse({ callId: row.call_id, reservationId: row.reservation_id, requestHash: row.request_hash, state: row.state, settlementHash: row.settlement_hash }));
    }
    counts() { check(!this.closed, 'EXECUTOR_CLOSED'); return Object.fromEntries(this.db.prepare('SELECT state,count(*) AS n FROM executor_jobs GROUP BY state').all().map(row => [ExecutorStateSchema.parse(row.state), Number(row.n)])); }
    prepare(raw, rawBinding, now = Date.now()) {
        const spec = ExecutorJobSpecSchema.parse(raw), binding = ExecutorOperationBindingSchema.parse(rawBinding);
        this.scope(spec.scope);
        const fingerprint = executorHash(spec);
        return this.transaction(() => {
            const linked = this.db.prepare('SELECT job_id FROM executor_job_operations WHERE operation_id=?').get(binding.operationId), old = this.db.prepare('SELECT id,fingerprint FROM executor_jobs WHERE scope_key=? AND intent_version=? AND request_id=?').get(spec.scope.scopeKey, spec.intentVersion, spec.requestId);
            if (linked)
                check(old && linked.job_id === old.id, 'EXECUTOR_OPERATION_CONFLICT');
            if (old) {
                check(old.fingerprint === fingerprint, 'EXECUTOR_REQUEST_CONFLICT');
                const job = this.get(String(old.id), spec.scope);
                this.operation(job, binding);
                return { job, created: false };
            }
            check(!this.db.prepare("SELECT 1 FROM executor_jobs WHERE state IN ('prepared','launching','running','unknown') LIMIT 1").get(), 'EXECUTOR_PROFILE_UNRESOLVED');
            const id = randomUUID(), at = this.time(now);
            this.db.prepare("INSERT INTO executor_jobs(id,scope_key,intent_version,request_id,fingerprint,body,body_hash,state,version,created_at,updated_at) VALUES(?,?,?,?,?,?,?,'prepared',1,?,?)")
                .run(id, spec.scope.scopeKey, spec.intentVersion, spec.requestId, fingerprint, JSON.stringify(spec), fingerprint, at, at);
            this.append({ schemaVersion: 1, id: randomUUID(), jobId: id, version: 1, at, type: 'prepared', requestHash: fingerprint });
            const job = this.get(id, spec.scope);
            this.operation(job, binding);
            return { job, created: true };
        });
    }
    claimLaunch(id, scope, expectedVersion, nonceHash, now = Date.now()) {
        ExecutorHashSchema.parse(nonceHash);
        return this.transaction(() => {
            const job = this.get(id, scope);
            check(job.version === expectedVersion, 'EXECUTOR_VERSION_CONFLICT');
            check(job.state === 'prepared' && !job.cancelRequested, 'EXECUTOR_DISPATCH_FORBIDDEN');
            check(!this.db.prepare('SELECT 1 FROM executor_jobs WHERE nonce_hash=?').get(nonceHash), 'EXECUTOR_NONCE_REUSED');
            const at = this.time(now), version = job.version + 1;
            this.db.prepare("UPDATE executor_jobs SET state='launching',version=?,nonce_hash=?,updated_at=? WHERE id=?").run(version, nonceHash, at, id);
            this.append({ schemaVersion: 1, id: randomUUID(), jobId: id, version, at, type: 'launching', nonceHash });
            return this.get(id, scope);
        });
    }
    running(id, scope, expectedVersion, raw, now = Date.now()) {
        const handshake = ExecutorHandshakeSchema.parse(raw);
        return this.transaction(() => {
            const job = this.get(id, scope);
            check(handshake.nonceHash === job.nonceHash && handshake.profileHash === job.spec.profileHash && handshake.process.executableHash === job.spec.executableHash, 'EXECUTOR_HANDSHAKE_MISMATCH');
            if (job.state === 'running') {
                check(executorHash(job.process) === executorHash(handshake.process), 'EXECUTOR_PROCESS_CONFLICT');
                return job;
            }
            check(job.version === expectedVersion, 'EXECUTOR_VERSION_CONFLICT');
            check(job.state === 'launching' && !job.cancelRequested, 'EXECUTOR_DISPATCH_FORBIDDEN');
            check(!this.db.prepare("SELECT 1 FROM executor_jobs WHERE json_extract(process,'$.pid')=? AND json_extract(process,'$.creationId')=?").get(handshake.process.pid, handshake.process.creationId), 'EXECUTOR_PROCESS_REUSED');
            const at = this.time(now), version = job.version + 1;
            this.db.prepare("UPDATE executor_jobs SET state='running',version=?,process=?,updated_at=? WHERE id=?").run(version, JSON.stringify(handshake.process), at, id);
            this.append({ schemaVersion: 1, id: randomUUID(), jobId: id, version, at, type: 'running', handshake });
            return this.get(id, scope);
        });
    }
    requestCancel(id, scope, code, now = Date.now()) {
        ExecutorCodeSchema.parse(code);
        return this.transaction(() => {
            const job = this.get(id, scope);
            if (job.cancelRequested || job.receipt)
                return job;
            const at = this.time(now), version = job.version + 1;
            this.db.prepare('UPDATE executor_jobs SET cancel_requested=1,version=?,updated_at=? WHERE id=?').run(version, at, id);
            this.append({ schemaVersion: 1, id: randomUUID(), jobId: id, version, at, type: 'cancel-requested', code });
            return this.get(id, scope);
        });
    }
    sealInternal(job, expectedVersion, terminal, at) {
        if (job.receipt) {
            const { schemaVersion: _schema, id: _id, jobId: _job, createdAt: _at, nonceHash: _nonce, process: _process, ...prior } = job.receipt;
            check(executorHash(prior) === executorHash(terminal), 'EXECUTOR_RECEIPT_CONFLICT');
            return job.receipt;
        }
        check(job.version === expectedVersion, 'EXECUTOR_VERSION_CONFLICT');
        if (job.state === 'prepared')
            check(['failed', 'cancelled'].includes(terminal.state) && terminal.effects === 'none' && terminal.exit === null && terminal.output === null && terminal.sessionId === null, 'EXECUTOR_TERMINAL_UNPROVEN');
        else if (job.state === 'launching')
            check(terminal.state === 'unknown', 'EXECUTOR_TERMINAL_UNPROVEN');
        else
            check(job.state === 'running' && (terminal.state === 'unknown' || terminal.exit?.verified === true), 'EXECUTOR_TERMINAL_UNPROVEN');
        if (terminal.state !== 'unknown')
            check(!this.db.prepare("SELECT 1 FROM executor_budget_links WHERE job_id=? AND state<>'settled'").get(job.id), 'EXECUTOR_BUDGET_PENDING');
        const receipt = ExecutorReceiptSchema.parse({ ...terminal, schemaVersion: 1, id: randomUUID(), jobId: job.id, createdAt: at, nonceHash: job.nonceHash, process: job.process }), hash = executorHash(receipt), version = job.version + 1;
        this.db.prepare('INSERT INTO executor_receipts VALUES(?,?,?,?)').run(receipt.id, job.id, JSON.stringify(receipt), hash);
        this.db.prepare('UPDATE executor_jobs SET state=?,version=?,updated_at=? WHERE id=?').run(receipt.state, version, at, job.id);
        this.append({ schemaVersion: 1, id: randomUUID(), jobId: job.id, version, at, type: 'terminal', receipt: { id: receipt.id, hash } });
        return receipt;
    }
    seal(id, scope, expectedVersion, raw, now = Date.now()) { const terminal = ExecutorTerminalSchema.parse(raw); return this.transaction(() => this.sealInternal(this.get(id, scope), expectedVersion, terminal, this.time(now))); }
    /** Called under the owner's recovery lease. It never spawns, reattaches authority, or resolves unknown effects. */
    recover(now = Date.now()) {
        return this.transaction(() => {
            const at = this.time(now), rows = this.db.prepare("SELECT id,body FROM executor_jobs WHERE state IN ('prepared','launching','running') ORDER BY rowid").all();
            return rows.map(row => {
                const spec = ExecutorJobSpecSchema.parse(JSON.parse(String(row.body))), job = this.get(String(row.id), spec.scope), unstarted = job.state === 'prepared';
                return this.sealInternal(job, job.version, { state: unstarted ? 'failed' : 'unknown', effects: unstarted ? 'none' : 'unknown', sessionId: null, exit: null, output: null, gaps: [unstarted ? 'EXECUTOR_NOT_DISPATCHED' : 'EXECUTOR_RECOVERY_UNCERTAIN'] }, at);
            });
        });
    }
    unresolved() { check(!this.closed, 'EXECUTOR_CLOSED'); return Number(this.db.prepare("SELECT count(*) AS n FROM executor_jobs WHERE state IN ('prepared','launching','running','unknown')").get()?.n); }
    close() { if (this.closed)
        return; this.closed = true; this.db.close(); }
}
