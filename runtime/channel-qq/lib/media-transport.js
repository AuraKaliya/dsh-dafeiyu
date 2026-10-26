import { createHash } from 'node:crypto';
const safe = (error) => error instanceof Error && /^[A-Z][A-Z0-9_]{0,99}$/.test(error.message) ? error.message : 'MEDIA_DELIVERY_PRECHECK_FAILED';
function result(value, code) {
    if (value.state === 'sent')
        return { status: 'sent', receiptId: value.parts[0].receipt };
    return value.confirmed || value.unknown || value.state === 'sending' ? { status: 'unknown', code: value.unknown || value.state === 'sending' ? 'PLATFORM_RESULT_UNKNOWN' : 'PARTIAL_DELIVERY' } : { status: 'not-sent', code };
}
/** No generation, file paths or re-rendering. Each approved part has one durable external-effect transition. */
export class QqMediaTransport {
    host;
    active = new Map();
    constructor(host) {
        this.host = host;
    }
    deliver(reply, signal, authority, bytes) {
        if (typeof authority !== 'function' || typeof bytes !== 'function')
            return Promise.resolve({ status: 'not-sent', code: 'TARGET_NOT_ALLOWED' });
        let plan;
        try {
            plan = this.host.ledger.prepare(reply);
        }
        catch (error) {
            const old = this.host.ledger.progress(reply.id) ?? this.host.legacyProgress(reply.id);
            return Promise.resolve(old && (old.confirmed || old.unknown || old.state === 'sending') ? { status: 'unknown', code: 'DELIVERY_PLAN_CONFLICT' } : { status: 'not-sent', code: safe(error) });
        }
        const running = this.active.get(reply.id);
        if (running)
            return running;
        const progress = this.host.ledger.progress(reply.id);
        if (progress.state === 'sent' || progress.unknown || progress.state === 'sending')
            return Promise.resolve(result(progress, 'DELIVERY_NOT_RESUMABLE'));
        const snapshot = { id: plan.replyId, conversation: plan.target, sourceMessageId: plan.sourceMessageId, text: plan.parts.filter(p => p.kind === 'text').map(p => p.text).join(''), media: plan.manifest, ...(plan.manifest.anchor.kind === 'task-result' ? { taskResult: plan.manifest.anchor } : {}) };
        const work = this.execute(snapshot, plan, signal, authority, bytes).finally(() => this.active.delete(reply.id));
        this.active.set(reply.id, work);
        return work;
    }
    async execute(reply, plan, signal, authority, bytes) {
        const guard = () => { if (signal.aborted)
            throw new Error('DELIVERY_CANCELLED'); try {
            authority();
        }
        catch {
            throw new Error('DELIVERY_AUTHORITY_REVOKED');
        } };
        let mediaPosition = 0;
        for (const [position, part] of plan.parts.entries()) {
            const mediaIndex = part.kind === 'text' ? null : mediaPosition++;
            const progress = this.host.ledger.progress(reply.id);
            if (progress.state === 'sent' || progress.unknown || progress.state === 'sending')
                return result(progress, 'DELIVERY_NOT_RESUMABLE');
            if (progress.parts[position].state === 'sent')
                continue;
            let invoked = false;
            try {
                guard();
                let data = null;
                if (part.kind !== 'text') {
                    data = Buffer.from(await bytes(mediaIndex));
                    if (data.length !== part.asset.bytes || data.length > 16 * 1024 ** 2 || createHash('sha256').update(data).digest('hex') !== part.asset.sha256)
                        throw new Error('MEDIA_BLOB_CORRUPT');
                }
                guard();
                await this.host.check(reply, signal);
                guard();
                this.host.ledger.begin(reply.id, position);
                invoked = true;
                const receipt = await this.host.send(reply, part, data, signal);
                this.host.ledger.confirm(reply.id, position, receipt);
                this.host.confirmed(reply, part, receipt);
            }
            catch (error) {
                const current = this.host.ledger.progress(reply.id);
                if (current.parts[position].state === 'sending')
                    this.host.ledger.unknown(reply.id, position, 'PLATFORM_RESULT_UNKNOWN');
                else if (current.parts[position].state === 'pending')
                    this.host.ledger.defer(reply.id, position, safe(error));
                return result(this.host.ledger.progress(reply.id), invoked ? 'LOCAL_PROJECTION_FAILED' : safe(error));
            }
        }
        return result(this.host.ledger.progress(reply.id), 'DELIVERY_INCOMPLETE');
    }
}
