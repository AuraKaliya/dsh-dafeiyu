import type { Conversation, ExecutionScope, ResourceTargetView } from '#dafeiyu/contracts';
import type { ActionCapabilityV3, ExtensionV3, ExtensionHandleV3, ExecutionContextV3, ActionOutcome, Json, ContextContributorV3, ResourceProof, TimelineScope } from '#dafeiyu/contracts';
import { toolParameters } from './tool-schema.js';
interface ReservedNames {
    ids: readonly string[];
    actions: readonly string[];
    channels: readonly string[];
}
export interface BoundActionV3 {
    readonly id: string;
    readonly owner: string;
    readonly version: string;
    readonly pluginVersion: string;
    readonly description: string;
    readonly input: Record<string, unknown>;
    readonly effects: ActionCapabilityV3['effects'];
    readonly requiresTask: boolean;
    readonly parameters: ReturnType<typeof toolParameters>;
    readonly active: () => boolean;
    readonly signal: AbortSignal;
    validateInput(raw: unknown): Json;
    execute(raw: unknown, context: ExecutionContextV3): Promise<ActionOutcome>;
}
/** Registration snapshots. Invocation authority is issued by the core Run coordinator. */
export declare class CapabilityRegistryV3 {
    private resourceState;
    resourceCurrent(proof: ResourceProof): boolean;
    publicView(proof: ResourceProof, view: string): boolean;
    targetView(proof: ResourceProof, view: string, target: Conversation, scope: ExecutionScope): ResourceTargetView | null;
    resourceEpoch(scope?: TimelineScope, excluding?: string): string;
    contributors(): {
        owner: string;
        version: string;
        context: ContextContributorV3;
        active: () => boolean;
        signal: AbortSignal;
    }[];
    private readonly entries;
    hasId(id: string): boolean;
    actionNames(): string[];
    channelKeys(): string[];
    ids(): string[];
    contexts(): {
        owner: string;
        context: ContextContributorV3;
        active: () => boolean;
    }[];
    actions(): BoundActionV3[];
    providedFeatures(): string[];
    checkReady(available?: readonly string[]): void;
    register(agentId: string, extension: ExtensionV3, reserved: ReservedNames): ExtensionHandleV3;
    close(): void;
}
export {};
