import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AnalysisError, jobSchema, authoritySchema } from './analysis-types.js';
import { MEMORY_VERSION } from './types.js';
const auditSchema = z.strictObject({ id: z.uuid(), scope: authoritySchema, jobId: z.uuid(), state: jobSchema.shape.state,
    at: z.iso.datetime(), count: z.number().int(), committed: z.number().int(), review: z.number().int(), error: z.string().nullable(), pluginVersion: z.string() });
/** Durable queue and candidate acknowledgements; memory commits use their own idempotency ledger. */
export class AnalysisStore {
    db;
    nonce = randomUUID();
    constructor(file, deferRecovery = false) {
        mkdirSync(dirname(file), { recursive: true });
        this.db = new DatabaseSync(file);
        try {
            const app = this.db.prepare('PRAGMA application_id').get()?.application_id;
            const version = this.db.prepare('PRAGMA user_version').get()?.user_version;
            const tables = this.db.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table'").get()?.n;
            const fresh = app === 0 && version === 0 && tables === 0;
            if (!fresh && (app !== 0x44464131 || version !== 1))
                throw new Error('Unsupported analysis database');
            this.db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;');
            if (fresh)
                this.db.exec(`CREATE TABLE jobs(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,
        agent_id TEXT NOT NULL,route TEXT NOT NULL,request_id TEXT NOT NULL,state TEXT NOT NULL,body TEXT NOT NULL,
        UNIQUE(agent_id,route,request_id));
        CREATE TABLE ownership(singleton INTEGER PRIMARY KEY CHECK(singleton=1),pid INTEGER NOT NULL,nonce TEXT NOT NULL);
        CREATE TABLE audit_outbox(ordinal INTEGER PRIMARY KEY AUTOINCREMENT,id TEXT UNIQUE NOT NULL,body TEXT NOT NULL,delivered INTEGER NOT NULL DEFAULT 0);
        PRAGMA application_id=1145454897; PRAGMA user_version=1;`);
            this.db.exec('BEGIN IMMEDIATE');
            try {
                const owner = this.db.prepare('SELECT pid FROM ownership WHERE singleton=1').get();
                if (owner) {
                    let alive = true;
                    try {
                        process.kill(Number(owner.pid), 0);
                    }
                    catch (error) {
                        if (error instanceof Error && 'code' in error && error.code === 'ESRCH')
                            alive = false;
                        else
                            throw error;
                    }
                    if (alive)
                        throw new Error('Analysis queue already owned');
                }
                this.db.prepare('INSERT OR REPLACE INTO ownership VALUES(1,?,?)').run(process.pid, this.nonce);
                this.db.exec('COMMIT');
            }
            catch (error) {
                this.db.exec('ROLLBACK');
                throw error;
            }
            if (!deferRecovery)
                this.recover();
        }
        catch (error) {
            this.db.close();
            throw error;
        }
    }
    recover() { for (const job of this.pending())
        if (job.state === 'running') {
            job.state = 'queued';
            this.save(job);
        } }
    decode(body) { return jobSchema.parse(JSON.parse(z.string().parse(body))); }
    get(scope, id) {
        const row = this.db.prepare('SELECT body FROM jobs WHERE agent_id=? AND route=? AND id=?').get(scope.agentId, scope.route, id);
        return row ? this.decode(row.body) : null;
    }
    request(scope, requestId, fingerprint) {
        const row = this.db.prepare('SELECT body FROM jobs WHERE agent_id=? AND route=? AND request_id=?').get(scope.agentId, scope.route, requestId);
        if (!row)
            return null;
        const job = this.decode(row.body);
        if (job.fingerprint !== fingerprint)
            throw new AnalysisError('idempotency_conflict');
        return job;
    }
    *pending() {
        for (const row of this.db.prepare("SELECT body FROM jobs WHERE state IN ('queued','running','committing') ORDER BY ordinal").iterate())
            yield this.decode(row.body);
    }
    firstPending() {
        const row = this.db.prepare("SELECT body FROM jobs WHERE state IN ('queued','running','committing') ORDER BY ordinal LIMIT 1").get();
        return row ? this.decode(row.body) : null;
    }
    insert(job) {
        this.transaction(() => {
            this.db.prepare('INSERT INTO jobs(id,agent_id,route,request_id,state,body) VALUES(?,?,?,?,?,?)')
                .run(job.id, job.agentId, job.route, job.requestId, job.state, JSON.stringify(jobSchema.parse(job)));
            this.audit(job);
        });
    }
    save(job) {
        job.updatedAt = new Date().toISOString();
        this.transaction(() => {
            this.db.prepare('UPDATE jobs SET state=?,body=? WHERE id=? AND agent_id=? AND route=?')
                .run(job.state, JSON.stringify(jobSchema.parse(job)), job.id, job.agentId, job.route);
            this.audit(job);
        });
    }
    transaction(work) {
        this.db.exec('BEGIN IMMEDIATE');
        try {
            work();
            this.db.exec('COMMIT');
        }
        catch (error) {
            this.db.exec('ROLLBACK');
            throw error;
        }
    }
    audit(job) {
        const record = { id: randomUUID(), scope: job.authority, jobId: job.id, state: job.state, at: job.updatedAt,
            count: job.candidates.length, committed: job.candidates.filter(c => c.status === 'committed').length,
            review: job.candidates.filter(c => c.status === 'needs_review').length, error: job.error ?? null, pluginVersion: MEMORY_VERSION };
        this.db.prepare('INSERT INTO audit_outbox(id,body) VALUES(?,?)').run(record.id, JSON.stringify(record));
    }
    flush(publish) {
        for (const row of this.db.prepare('SELECT body FROM audit_outbox WHERE delivered=0 ORDER BY ordinal').iterate()) {
            try {
                const record = auditSchema.parse(JSON.parse(z.string().parse(row.body))), scope = record.scope;
                publish({ agentId: scope.agentId, route: scope.route, traceId: scope.traceId, operationId: scope.operationId, causedBy: scope.startedEventId,
                    type: ['completed', 'failed', 'cancelled'].includes(record.state) ? 'memory.analysis.finished' : `memory.analysis.${record.state}`,
                    plugin: 'memory', pluginVersion: record.pluginVersion, occurredAt: record.at, sources: [],
                    data: { jobId: record.jobId, state: record.state, count: record.count, committed: record.committed, review: record.review, error: record.error } }, record.id);
                this.db.prepare('UPDATE audit_outbox SET delivered=1 WHERE id=?').run(record.id);
            }
            catch {
                break;
            }
        }
        return Number(this.db.prepare('SELECT count(*) AS n FROM audit_outbox WHERE delivered=0').get()?.n);
    }
    close() {
        try {
            this.db.prepare('DELETE FROM ownership WHERE singleton=1 AND nonce=?').run(this.nonce);
        }
        finally {
            this.db.close();
        }
    }
}
