import { mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import { ExternalTaskAuthorizationSchema, redactJson } from '#dafeiyu/contracts';
const state = z.enum(['queued', 'applying', 'applied', 'failed', 'restart-required', 'unknown']);
const rowSchema = z.strictObject({ id: z.uuid(), createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(), state, ownerPid: z.number().int().positive().nullable().default(null), hostPid: z.number().int().positive().nullable().default(null), catalogVersion: z.string().length(64).nullable().default(null), arguments: z.json(), authorization: ExternalTaskAuthorizationSchema, result: z.json().nullable() });
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** A durable handoff to DSH's installer, after the originating reply and task have settled. */
export class DeferredPluginChanges {
    directory;
    dispatch;
    rows = new Map();
    busy = false;
    constructor(directory, dispatch) {
        this.directory = directory;
        this.dispatch = dispatch;
        this.refresh(true);
    }
    refresh(recover = false) {
        if (!existsSync(this.directory))
            return;
        for (const name of readdirSync(this.directory).filter(name => /^[a-f0-9-]{36}\.json$/.test(name))) {
            const row = rowSchema.parse(JSON.parse(readFileSync(join(this.directory, name), 'utf8')));
            if (name !== row.id + '.json')
                throw new Error('DSH_UPDATE_RECORD_INVALID');
            if (recover && row.state === 'applying' && row.ownerPid !== process.pid) {
                row.state = 'unknown';
                row.updatedAt = new Date().toISOString();
                this.save(row);
            }
            this.rows.set(row.id, row);
        }
    }
    save(row) { mkdirSync(this.directory, { recursive: true }); const value = rowSchema.parse(row), file = join(this.directory, row.id + '.json'), temp = file + '.' + randomUUID() + '.tmp'; writeFileSync(temp, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' }); renameSync(temp, file); this.rows.set(row.id, value); }
    enqueue(authorization, args, catalogVersion = null) {
        this.refresh();
        if (redactJson(args).redacted)
            throw new Error('PRIVATE_INPUT_REJECTED');
        const id = authorization.operationId, old = this.rows.get(id);
        if (old) {
            if (hash(old.arguments) !== hash(args) || hash(old.authorization) !== hash(authorization))
                throw new Error('IDEMPOTENCY_CONFLICT');
            return old;
        }
        if ([...this.rows.values()].some(row => row.state === 'queued' || row.state === 'applying'))
            throw new Error('DSH_PLUGIN_CHANGE_PENDING');
        const now = new Date().toISOString(), row = { id, arguments: args, authorization, state: 'queued', ownerPid: null, hostPid: process.pid, catalogVersion, createdAt: now, updatedAt: now, result: null };
        this.save(row);
        return row;
    }
    status() { this.refresh(); return [...this.rows.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-10).map(row => ({ id: row.id, state: row.state, updatedAt: row.updatedAt })); }
    notifications() { this.refresh(); return [...this.rows.values()].filter(row => row.catalogVersion !== null && ['applied', 'failed', 'restart-required', 'unknown'].includes(row.state)).slice(-16); }
    async idle(validate) {
        if (this.busy)
            return;
        this.refresh();
        const row = [...this.rows.values()].find(row => row.state === 'queued');
        if (!row)
            return;
        this.busy = true;
        try {
            if (!await validate(row)) {
                row.state = 'failed';
                row.result = { code: 'SOURCE_STALE' };
            }
            else {
                row.state = 'applying';
                row.ownerPid = process.pid;
                row.updatedAt = new Date().toISOString();
                this.save(row);
                const result = await this.dispatch(row);
                row.result = redactJson(result).value;
                const application = z.object({ application: z.string() }).safeParse(result);
                row.state = application.success && ['applied', 'failed', 'restart-required'].includes(application.data.application) ? state.parse(application.data.application) : 'unknown';
            }
        }
        catch {
            row.state = 'unknown';
            row.result = { code: 'DSH_PLUGIN_CHANGE_UNKNOWN' };
        }
        finally {
            row.updatedAt = new Date().toISOString();
            this.save(row);
            this.busy = false;
        }
    }
}
