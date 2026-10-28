import type { ContextContributor, ContextRequest, ContextItem, Conversation, Json, SourceDependency } from '#dafeiyu/contracts';
export interface ResponsibilityFact {
    id: string;
    version: string;
    data: Json;
    proof: Json;
    guard(): void;
}
/** Required bounded index, not a replacement for authoritative Task records or full goals. */
export declare function situationContributor(enabled: () => boolean, read: (scene: Conversation) => readonly ResponsibilityFact[], record: (request: ContextRequest, item: ContextItem, proof: Json) => void, historical: (request: ContextRequest, dependency: Extract<SourceDependency, {
    kind: 'context';
}>) => boolean): ContextContributor;
