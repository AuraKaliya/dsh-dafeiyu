import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import { z } from 'zod';
import { BiliOwnerConfigSchema } from './config.js';
import type { BiliOwnerConfig } from './config.js';
import { BiliOwnerStore } from './store.js';
import type { BiliOwnerPorts } from './types.js';
declare module '@deepseek-ai/cordis' {
    interface Context {
        dafeiyuBiliOwner: BiliOwnerChannel;
    }
}
/** Managed native channel. All real IO/consumer ownership must be provided by a trusted launcher; no ambient credential fallback. */
export declare class BiliOwnerChannel extends Service {
    private readonly ports;
    readonly config: z.output<typeof BiliOwnerConfigSchema>;
    readonly store: BiliOwnerStore;
    private readonly gate;
    private readonly controller;
    private readonly handle;
    private readonly tasks;
    private readonly now;
    private readonly identityHash;
    private readonly epoch;
    private readonly root;
    private verified;
    private held;
    private closed;
    private automatic;
    private tickWork;
    private timer;
    private nextAt;
    private lastPollAt;
    private error;
    private closing;
    private readonly sending;
    private finalCounts;
    private finalCursor;
    private finalReady;
    private finalBindingFault;
    private ownedFiber;
    /** Transfers the injected resources once; failed construction also disposes its own Cordis scope and releases the ports. */
    static open(ctx: Context, raw: BiliOwnerConfig, ports: BiliOwnerPorts): Promise<BiliOwnerChannel>;
    private constructor();
    private guard;
    private sourceReady;
    private checkIdentity;
    private verify;
    recover(): {
        unknown: number;
    };
    activate(): void;
    holdIngress(): void;
    private backgroundTick;
    releaseIngress(): void;
    start(automatic?: boolean): Promise<void>;
    tick(): Promise<void>;
    private poll;
    private incoming;
    private admitPending;
    /** Trusted platform-recall seam only. A missing item on a bounded page is never treated as recall. */
    private recordRecall;
    recall(messageId: string): void;
    private checkSource;
    private deliverTaskResult;
    private deliver;
    private send;
    quiesce(): void;
    cancelRunning(): void;
    whenIdle(): Promise<void>;
    getStatus(): {
        lifecycle: import("#dafeiyu/contracts").ServicePhase;
        accountUid: string;
        ownerUid: string;
        transport: "program-injected";
        verified: boolean;
        ingressHeld: boolean;
        polling: boolean;
        inFlight: number;
        lastPollAt: string | null;
        error: string | null;
        backoffUntil: number;
        bindingReady: boolean;
        bindingFault: string | null;
        counts: {
            inbound: {
                [k: string]: number;
            };
            deliveries: {
                [k: string]: number;
            };
        };
        leaseEpoch: number;
    };
    close(): Promise<void>;
}
export declare const openBiliOwnerChannel: (ctx: Context, config: BiliOwnerConfig, ports: BiliOwnerPorts) => Promise<BiliOwnerChannel>;
