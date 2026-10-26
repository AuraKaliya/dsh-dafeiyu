import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ConversationSchema, TaskResultAnchorSchema, ReplyMediaManifestSchema, ReplyMediaPartSchema } from '#dafeiyu/contracts';
import { splitQqText } from './delivery.js';
function canonical(value) { const valid = z.json().parse(value); if (valid === null || typeof valid !== 'object')
    return JSON.stringify(valid); if (Array.isArray(valid))
    return '[' + valid.map(canonical).join(',') + ']'; return '{' + Object.keys(valid).sort().map(key => JSON.stringify(key) + ':' + canonical(valid[key])).join(',') + '}'; }
export const qqMediaHash = (value) => createHash('sha256').update(canonical(value)).digest('hex');
export const qqTextHash = (text) => createHash('sha256').update(text).digest('hex');
const state = z.enum(['pending', 'sending', 'sent', 'unknown']);
const part = z.union([z.strictObject({ kind: z.literal('text'), text: z.string().min(1).max(4000) }), ReplyMediaPartSchema]);
const planSchema = z.strictObject({ version: z.literal(2), replyId: z.string(), target: ConversationSchema, sourceMessageId: z.string(), textHash: z.string().length(64), manifest: ReplyMediaManifestSchema, parts: z.array(part).min(2).max(72) });
const progressPart = z.strictObject({ position: z.number().int().nonnegative(), state, receipt: z.string().nullable(), code: z.string().nullable() });
/** Builds fixed bytes/identity metadata, never authorizes those bytes or invokes a platform. */
export function qqMediaDeliveryPlan(reply) {
    const manifest = ReplyMediaManifestSchema.parse(reply.media);
    if (manifest.replyId !== reply.id || qqMediaHash(manifest.target) !== qqMediaHash(reply.conversation) || manifest.sourceMessageId !== reply.sourceMessageId || manifest.textHash !== qqTextHash(reply.text))
        throw new Error('DELIVERY_MANIFEST_MISMATCH');
    if (reply.taskResult) {
        const anchor = TaskResultAnchorSchema.parse(reply.taskResult);
        if (manifest.anchor.kind !== 'task-result' || qqMediaHash(anchor) !== qqMediaHash(manifest.anchor) || manifest.runId !== anchor.runId)
            throw new Error('DELIVERY_MANIFEST_MISMATCH');
    }
    else if (manifest.anchor.kind !== 'reply' || reply.id !== manifest.anchor.inboundId + ':reply')
        throw new Error('DELIVERY_MANIFEST_MISMATCH');
    return planSchema.parse({ version: 2, replyId: reply.id, target: reply.conversation, sourceMessageId: reply.sourceMessageId, textHash: manifest.textHash, manifest, parts: [...splitQqText(reply.text).map(text => ({ kind: 'text', text })), ...manifest.parts] });
}
export class QqMediaDeliveryLedger {
    db;
    constructor(db) {
        this.db = db;
    }
    atomic(work) { this.db.exec('BEGIN IMMEDIATE'); try {
        const result = work();
        this.db.exec('COMMIT');
        return result;
    }
    catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
    } }
    plan(id) {
        const row = this.db.prepare('SELECT body,plan_hash FROM qq_media_deliveries WHERE reply_id=?').get(id);
        if (!row)
            return null;
        const plan = planSchema.parse(JSON.parse(String(row.body)));
        if (plan.replyId !== id || qqMediaHash(plan) !== row.plan_hash)
            throw new Error('DELIVERY_LEDGER_CORRUPT');
        const expected = qqMediaDeliveryPlan({ id: plan.replyId, conversation: plan.target, sourceMessageId: plan.sourceMessageId, text: plan.parts.filter(p => p.kind === 'text').map(p => p.text).join(''), media: plan.manifest, ...(plan.manifest.anchor.kind === 'task-result' ? { taskResult: plan.manifest.anchor } : {}) });
        if (qqMediaHash(plan) !== qqMediaHash(expected))
            throw new Error('DELIVERY_LEDGER_CORRUPT');
        return plan;
    }
    prepare(reply) {
        const plan = qqMediaDeliveryPlan(reply);
        return this.atomic(() => {
            const old = this.plan(reply.id);
            if (old) {
                if (qqMediaHash(old) !== qqMediaHash(plan))
                    throw new Error('DELIVERY_PLAN_CONFLICT');
                return old;
            }
            if (this.db.prepare('SELECT 1 FROM qq_delivery_plans WHERE reply_id=?').get(reply.id) || this.db.prepare('SELECT 1 FROM receipts WHERE reply_id=?').get(reply.id))
                throw new Error('DELIVERY_PROTOCOL_CONFLICT');
            this.db.prepare('INSERT INTO qq_media_deliveries VALUES(?,?,?)').run(reply.id, qqMediaHash(plan), JSON.stringify(plan));
            const insert = this.db.prepare("INSERT INTO qq_media_parts VALUES(?,?,'pending',NULL,NULL)");
            plan.parts.forEach((_part, index) => insert.run(reply.id, index));
            return plan;
        });
    }
    progress(id) {
        const plan = this.plan(id);
        if (!plan)
            return null;
        const parts = this.db.prepare('SELECT position,state,receipt,code FROM qq_media_parts WHERE reply_id=? ORDER BY position').all(id).map(r => progressPart.parse(r));
        if (parts.length !== plan.parts.length || parts.some((p, i) => p.position !== i || (p.state === 'sent' ? !p.receipt || !/^[-]?\d{1,79}$/.test(p.receipt) : p.receipt !== null)))
            throw new Error('DELIVERY_LEDGER_CORRUPT');
        const count = (s) => parts.filter(p => p.state === s).length, confirmed = count('sent'), pending = count('pending'), unknown = count('unknown');
        return { replyId: id, planHash: qqMediaHash(plan), state: unknown ? 'uncertain' : count('sending') ? 'sending' : confirmed === parts.length ? 'sent' : confirmed ? 'partial' : 'ready', total: parts.length, confirmed, pending, unknown, parts };
    }
    begin(id, position) {
        this.atomic(() => {
            const status = this.progress(id);
            if (!status || status.unknown || status.state === 'sending' || status.parts.some(p => p.position < position && p.state !== 'sent'))
                throw new Error('DELIVERY_NOT_RESUMABLE');
            if (this.db.prepare("UPDATE qq_media_parts SET state='sending',code=NULL WHERE reply_id=? AND position=? AND state='pending'").run(id, position).changes !== 1)
                throw new Error('DELIVERY_STATE_CONFLICT');
        });
    }
    confirm(id, position, receipt) {
        z.string().regex(/^-?\d{1,79}$/).parse(receipt);
        this.atomic(() => {
            if (this.db.prepare("UPDATE qq_media_parts SET state='sent',receipt=?,code=NULL WHERE reply_id=? AND position=? AND state='sending'").run(receipt, id, position).changes !== 1)
                throw new Error('DELIVERY_STATE_CONFLICT');
            const status = this.progress(id);
            if (status.state === 'sent')
                this.db.prepare('INSERT INTO receipts VALUES(?,?)').run(id, status.parts[0].receipt);
        });
    }
    unknown(id, position, code) { this.code(id, position, 'sending', 'unknown', code); }
    defer(id, position, code) { this.code(id, position, 'pending', 'pending', code); }
    code(id, position, from, to, code) { z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).parse(code); if (this.db.prepare('UPDATE qq_media_parts SET state=?,code=? WHERE reply_id=? AND position=? AND state=?').run(to, code, id, position, from).changes !== 1)
        throw new Error('DELIVERY_STATE_CONFLICT'); }
    recover() { return Number(this.db.prepare("UPDATE qq_media_parts SET state='unknown',code='PROCESS_INTERRUPTED' WHERE state='sending'").run().changes); }
    counts() { return { plans: Number(this.db.prepare('SELECT count(*) AS n FROM qq_media_deliveries').get()?.n), pending: Number(this.db.prepare("SELECT count(*) AS n FROM qq_media_parts WHERE state='pending'").get()?.n), unknown: Number(this.db.prepare("SELECT count(*) AS n FROM qq_media_parts WHERE state='unknown'").get()?.n) }; }
}
