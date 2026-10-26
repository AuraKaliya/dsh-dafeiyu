import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { GenerateOptions, ContextFormed } from '@deepseek-ai/dsh-llm';
import type { PendingMessage, ContextItem } from '#dafeiyu/contracts';
import type { SourceDependency, CompactionScope } from '#dafeiyu/contracts';
import { ContextCoordinator } from './context.js';
export interface ContextEvidenceView {
    sourceItems(): {
        owner: string;
        region: string;
        item: ContextItem;
    }[];
    nativeDependencies(scope: CompactionScope): SourceDependency[];
    validateHistorical(dependency: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
}
declare module '@deepseek-ai/dsh-llm' {
    interface MessageSourceMap {
        'runtime-context': {
            kind: 'runtime-context';
        } & ContextFormed;
        'dafeiyu-context-retirement': {
            kind: 'dafeiyu-context-retirement';
        } & ContextFormed;
    }
}
/** Only the named core carrier is replaced; other DSH snapshot contributions survive verbatim. */
export declare class ContextRuntime {
    private readonly scope;
    private readonly coordinator;
    private agent;
    private item;
    private prepared;
    private packet;
    private allowance;
    private preparing;
    private nativeNames;
    private used;
    private retired;
    private repairs;
    private retryPending;
    private nativeSections;
    constructor(scope: Context, coordinator: ContextCoordinator);
    begin(item: PendingMessage, agent: Agent): void;
    end(): void;
    sourceItems(): {
        owner: string;
        region: string;
        item: {
            id: string;
            version: string;
            text: string;
            sources: {
                ref: string;
                version: string;
                hash: string;
            }[];
            expiresAt: string;
        };
    }[];
    nativeDependencies(scope: CompactionScope): SourceDependency[];
    validateHistorical(dep: Extract<SourceDependency, {
        kind: 'context';
    }>): boolean;
    private available;
    private retire;
    private render;
    /** Fail closed if a source changes after admission, or final native context exceeds the shared ceiling. */
    guard(options: GenerateOptions, audit?: boolean, allowRepair?: boolean): boolean;
}
