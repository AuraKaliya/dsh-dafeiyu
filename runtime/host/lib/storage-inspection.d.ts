import type { RuntimeIdentity } from '#dafeiyu/core/runtime-store';
export type StorageKind = 'journal' | 'memory' | 'runtime' | 'delivery' | 'analysis' | 'working' | 'feedback' | 'retrieval' | 'qq' | 'query' | 'activity' | 'media' | 'bilibili' | 'executor' | 'bili-owner';
export interface StorageInspection {
    kind: StorageKind;
    exists: boolean;
    version: number;
    applicationId: number;
    supported: boolean;
    activeOwner: boolean;
    integrity: boolean;
    identityMatches: boolean;
}
/** Metadata and integrity only. No service constructors, migrations or domain recovery are run. */
export declare function inspectStorage(file: string, kind: StorageKind, identity?: RuntimeIdentity): StorageInspection;
