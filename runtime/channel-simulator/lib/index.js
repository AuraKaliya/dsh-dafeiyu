import { Service } from '@deepseek-ai/cordis';
export const name = 'dafeiyu-channel-simulator';
export const inject = ['dafeiyu'];
/** Local-only transport; no sockets, login state, platform SDK, or remote credentials. */
export class Simulator extends Service {
    config;
    deliveries = [];
    outcomes = [];
    receipts = new Map();
    handle;
    constructor(ctx, config) {
        super(ctx, 'dafeiyuSimulator');
        this.config = config;
        this.handle = ctx.dafeiyu.registerExtension({ id: 'channel-simulator', version: '0.4.0', apiVersion: 2, agentId: config.agentId,
            channels: [{ channel: 'simulator', account: config.account, taskDelivery: 'simulated', deliver: async (reply, signal) => {
                        signal.throwIfAborted();
                        const existing = this.receipts.get(reply.id);
                        if (existing)
                            return existing;
                        const outcome = this.outcomes.shift() ?? { status: 'sent', receiptId: `sim:${reply.id}` };
                        if (outcome.status === 'sent') {
                            this.deliveries.push(reply);
                            this.receipts.set(reply.id, outcome);
                        }
                        return outcome;
                    } }],
        });
        ctx.effect(() => () => this.handle.dispose(), 'simulator.unregister');
    }
    /** Controls the next transmission outcome for deterministic failure tests. */
    nextDelivery(result) { this.outcomes.push(result); }
    send(conversation, text, options) {
        const message = { id: options.id, occurredAt: options.occurredAt ?? '2026-10-23T12:00:00+08:00',
            conversation: { channel: 'simulator', account: this.config.account, kind: 'local', id: conversation },
            sender: { id: options.sender ?? 'test-user', displayName: '本地测试用户' }, text };
        return this.handle.ingest(message);
    }
}
export function apply(ctx, config) { new Simulator(ctx, config); }
