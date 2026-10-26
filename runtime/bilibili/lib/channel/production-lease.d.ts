import type { BiliOwnerConsumerLease } from './types.js';
import type { PinnedBiliOwnerProductionBinding } from './production-config.js';
export declare const biliOwnerConsumerPipe: (identity: import("./types.js").BiliOwnerAccount) => string;
export declare function assertBiliOwnerProductionLease(lease: BiliOwnerConsumerLease, binding: PinnedBiliOwnerProductionBinding): void;
/** The fixed OS pipe excludes this implementation across profiles, not legacy consumers which do not acquire it. */
export declare function acquireBiliOwnerConsumerLease(binding: PinnedBiliOwnerProductionBinding): Promise<BiliOwnerConsumerLease>;
