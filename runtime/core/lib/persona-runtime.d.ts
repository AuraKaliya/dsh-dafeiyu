import type { PersonaAccess, PersonaProvider, PersonaManifest, PreparedPersonaTrialEntry, ExecutionInput, ContextItem, SourceDependency, PersonaTrialOutcomeRef } from '#dafeiyu/contracts';
import type { StoredRun, RuntimeStore } from './runtime-store.js';
import type { FoundationSnapshot } from './foundation.js';
import type { contextConfigSchema } from './context.js';
import { z } from 'zod';
export interface PersonaTrialCompletionStatus {
    readonly runId: string;
    readonly status: 'skipped' | 'completed' | 'missing-admission' | 'deferred';
    readonly outcomes: readonly PersonaTrialOutcomeRef[];
    readonly code: string | null;
}
export interface RunPersona {
    readonly manifest: PersonaManifest;
    readonly items: readonly ContextItem[];
    readonly projectionKey: string;
    readonly trialEntries: readonly PreparedPersonaTrialEntry[];
    guard(): void;
    dispose(): void;
}
export declare class PersonaRuntime {
    private readonly config;
    private provider;
    private readonly active;
    private readonly trialAuthorities;
    enrich: (access: PersonaAccess, run: StoredRun) => PersonaAccess;
    constructor(config: z.output<typeof contextConfigSchema>);
    bind(provider: PersonaProvider): () => void;
    get configured(): boolean;
    get ready(): boolean;
    prepareTarget(access: PersonaAccess): {
        items: {
            id: string;
            version: string;
            text: string;
            sources: {
                ref: string;
                version: string;
                hash: string;
            }[];
            expiresAt: string;
        }[];
        stamp: string;
        guard: () => void;
    };
    prepare(run: StoredRun, foundation: FoundationSnapshot, model: unknown, inputs: readonly ExecutionInput[], signal: AbortSignal, guard: () => void): RunPersona;
    access(run: StoredRun, inputs: readonly ExecutionInput[], signal: AbortSignal, guard: () => void): PersonaAccess;
    historical(access: PersonaAccess, dependency: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
    current(runId: string): RunPersona | undefined;
    validateStored(run: StoredRun, manifest: PersonaManifest, inputs: readonly ExecutionInput[], signal: AbortSignal, guard: () => void): void;
    assertTrialAuthority(authority: unknown, input: unknown): void;
    trialAccess(authority: unknown, input: unknown): PersonaAccess;
    admitTrial(store: RuntimeStore, runId: string, inputs: readonly ExecutionInput[], signal: AbortSignal, guard: () => void): void;
    completeTrial(store: RuntimeStore, runId: string, inputs: readonly ExecutionInput[], signal: AbortSignal): PersonaTrialCompletionStatus;
}
