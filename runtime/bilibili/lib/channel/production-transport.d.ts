import type { BiliOwnerConsumerLease, BiliOwnerPorts, BiliOwnerTransport } from './types.js';
import type { PinnedBiliOwnerProductionBinding } from './production-config.js';
export interface BiliOwnerProductionDependencies {
    readonly fetch?: typeof globalThis.fetch;
}
/** Uses only verified Auth bytes, with all platform requests passing this per-invocation guard. */
export declare function createBiliOwnerProductionTransport(binding: PinnedBiliOwnerProductionBinding, lease: BiliOwnerConsumerLease, dependencies?: BiliOwnerProductionDependencies): Promise<BiliOwnerTransport>;
/** Complete production acquisition. A failed construction releases only the newly acquired consumer lease. */
export declare function createBiliOwnerProductionPorts(raw: unknown, dependencies?: BiliOwnerProductionDependencies): Promise<BiliOwnerPorts>;
