import type { ExecutionScope, PersonaSourceRef } from '#dafeiyu/contracts';
export declare const personaDigest: (value: unknown) => string;
export declare const personaScope: (scope: ExecutionScope) => string;
export declare const sourceKey: (ref: PersonaSourceRef) => string;
export declare function uniqueSources(refs: readonly PersonaSourceRef[]): PersonaSourceRef[];
