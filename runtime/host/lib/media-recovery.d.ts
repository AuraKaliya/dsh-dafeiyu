import type { DafeiyuService } from '#dafeiyu/core';
import type { MediaService } from '#dafeiyu/media';
/** Reconcile only matching persisted facts. This module never constructs OneBot or reads credentials. */
export declare function reconcileMedia(core: DafeiyuService, media: MediaService, qqDirectory: string | undefined): {
    settled: number;
    pending: number;
    conflicts: number;
};
