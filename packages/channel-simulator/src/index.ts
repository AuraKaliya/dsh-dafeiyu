import {RELEASE_VERSION} from '@dafeiyu/contracts';
import {API_VERSION} from '@dafeiyu/contracts';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type { DeliveryResult, ExtensionHandle, InboundMessage, Reply } from '@dafeiyu/contracts';
import type {} from '@dafeiyu/core';

export const name = 'dafeiyu-channel-simulator';
export const inject = ['dafeiyu'];
export interface Config { agentId: string; account: string }
declare module '@deepseek-ai/cordis' { interface Context { dafeiyuSimulator: Simulator } }

/** Local-only transport; no sockets, login state, platform SDK, or remote credentials. */
export class Simulator extends Service {
  readonly deliveries: Reply[] = [];
  private readonly outcomes: DeliveryResult[] = [];
  private readonly receipts = new Map<string, DeliveryResult>();
  readonly handle: ExtensionHandle;
  constructor(ctx: Context, private readonly config: Config) {
    super(ctx, 'dafeiyuSimulator');
    this.handle = ctx.dafeiyu.registerExtension({ id: 'channel-simulator', version: RELEASE_VERSION, protocolVersion:API_VERSION, agentId: config.agentId,
      channels: [{ channel: 'simulator', account: config.account, deliver: async (reply, signal) => {
        signal.throwIfAborted();
        const existing = this.receipts.get(reply.id);
        if (existing) return existing;
        const outcome = this.outcomes.shift() ?? { status: 'sent', receiptId: `sim:${reply.id}` };
        if (outcome.status === 'sent') { this.deliveries.push(reply); this.receipts.set(reply.id, outcome); }
        return outcome;
      } }],
    });
    ctx.effect(() => () => this.handle.dispose(), 'simulator.unregister');
  }
  /** Controls the next transmission outcome for deterministic failure tests. */
  nextDelivery(result: DeliveryResult): void { this.outcomes.push(result); }
  send(conversation: string, text: string, options: { id: string; sender?: string; occurredAt?: string }) {
    const message: InboundMessage = { id: options.id, occurredAt: options.occurredAt ?? '2026-10-23T12:00:00+08:00',
      conversation: { channel: 'simulator', account: this.config.account, kind: 'local', id: conversation },
      sender: { id: options.sender ?? 'test-user', displayName: '本地测试用户' }, text };
    return this.handle.ingest(message);
  }
}
export function apply(ctx: Context, config: Config): void { new Simulator(ctx, config); }
