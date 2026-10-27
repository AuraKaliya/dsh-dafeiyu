const safeCode = (error, fallback) => error instanceof Error && ['CHANNEL_OFFLINE', 'TARGET_NOT_ALLOWED', 'IDENTITY_UNAVAILABLE', 'SOURCE_MESSAGE_NOT_FOUND', 'SOURCE_STALE', 'DELIVERY_CANCELLED', 'DELIVERY_AUTHORITY_REVOKED', 'DELIVERY_PLAN_CONFLICT', 'TEXT_SIZE_UNSUPPORTED', 'INVALID_TEXT_ENCODING'].includes(error.message) ? error.message : fallback;
function result(progress, code) {
    if (progress.state === 'sent')
        return { status: 'sent', receiptId: progress.segments[0].receipt };
    return progress.confirmed || progress.unknown || progress.state === 'sending' ? { status: 'unknown', code: progress.unknown || progress.state === 'sending' ? 'PLATFORM_RESULT_UNKNOWN' : 'PARTIAL_DELIVERY' } : { status: 'not-sent', code };
}
/** One sender per reply; a durable unknown is never interpreted as permission to resend. */
export class QqSegmentedTransport {
    host;
    active = new Map();
    constructor(host) {
        this.host = host;
    }
    deliver(reply, signal, authority = () => { }) {
        let plan;
        try {
            plan = this.host.ledger.prepare(reply);
        }
        catch (error) {
            const prior = this.host.ledger.progress(reply.id);
            return Promise.resolve(prior && prior.state !== 'ready' ? { status: 'unknown', code: 'DELIVERY_PLAN_CONFLICT' } : { status: 'not-sent', code: safeCode(error, 'DELIVERY_PLAN_INVALID') });
        }
        const existing = this.active.get(reply.id);
        if (existing)
            return existing;
        const progress = this.host.ledger.progress(reply.id);
        if (!plan || progress.state === 'sent' || progress.unknown || progress.state === 'sending')
            return Promise.resolve(result(progress, 'DELIVERY_NOT_RESUMABLE'));
        const { messageId, ...anchor } = plan.anchor;
        const snapshot = Object.freeze({ id: plan.replyId, conversation: Object.freeze({ ...plan.target }), sourceMessageId: messageId, text: plan.segments.join(''), ...(anchor.kind === 'task-result' ? { taskResult: Object.freeze({ ...anchor, target: Object.freeze({ ...anchor.target }) }) } : {}) });
        const work = this.execute(snapshot, plan, signal, authority).finally(() => this.active.delete(snapshot.id));
        this.active.set(snapshot.id, work);
        return work;
    }
    async execute(reply, plan, signal, authority) {
        const guard = () => { if (signal.aborted)
            throw new Error('DELIVERY_CANCELLED'); try {
            authority();
        }
        catch {
            throw new Error('DELIVERY_AUTHORITY_REVOKED');
        } };
        let delayed = false;
        for (let position = 0; position < plan.segments.length; position++) {
            const progress = this.host.ledger.progress(reply.id);
            if (progress.unknown || progress.state === 'sending')
                return result(progress, 'DELIVERY_NOT_RESUMABLE');
            if (progress.segments[position].state === 'sent')
                continue;
            let invoked = false;
            try {
                guard();
                if (!delayed && progress.confirmed === 0) {
                    await this.host.beforeSend?.(reply, signal);
                    delayed = true;
                }
                guard();
                await this.host.check(reply, signal);
                guard();
                this.host.ledger.begin(reply.id, position);
                invoked = true;
                const receipt = await this.host.send(reply, plan.segments[position], signal);
                this.host.ledger.confirm(reply.id, position, receipt);
                // A cache projection failure must not erase an already committed platform receipt.
                this.host.confirmed(reply, plan.segments[position], receipt);
            }
            catch (error) {
                const current = this.host.ledger.progress(reply.id);
                if (current.segments[position].state === 'sending')
                    this.host.ledger.unknown(reply.id, position, 'PLATFORM_RESULT_UNKNOWN');
                else if (current.segments[position].state === 'pending')
                    this.host.ledger.defer(reply.id, position, safeCode(error, 'DELIVERY_PRECHECK_FAILED'));
                return result(this.host.ledger.progress(reply.id), invoked ? 'LOCAL_PROJECTION_FAILED' : safeCode(error, 'DELIVERY_PRECHECK_FAILED'));
            }
        }
        return result(this.host.ledger.progress(reply.id), 'DELIVERY_INCOMPLETE');
    }
}
