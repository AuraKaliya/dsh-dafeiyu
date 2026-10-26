import type { MemoryBoundary, MemoryBoundaryPolicy, MemoryWriteBinding, TimelineScope } from '#dafeiyu/contracts';
export declare const boundaryDigest: (value: MemoryBoundary) => string;
export declare function conservativeBoundary(scope: TimelineScope, assignment: MemoryBoundary['assignment'], rawBinding?: MemoryWriteBinding): MemoryBoundary;
/** Sources and the previous head may narrow a new revision, never silently widen it. */
export declare function restrictBoundary(boundary: MemoryBoundary, ancestors: readonly MemoryBoundary[], rawPolicy?: MemoryBoundaryPolicy): MemoryBoundary;
