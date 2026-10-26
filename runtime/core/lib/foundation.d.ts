import type { PersonaSnapshot } from '#dafeiyu/contracts';
export interface FoundationSnapshot extends PersonaSnapshot {
    readonly fileIdentity: string;
}
/** A fixed UTF-8 foundation per Run. No fallback to a test persona or a mutable history summary. */
export declare function readFoundation(file: string): FoundationSnapshot;
