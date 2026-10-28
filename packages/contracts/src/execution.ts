import {API_VERSION} from './protocol.js';
import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import type { Json, ChannelCapability, Receipt } from './index.js';
import type { ContextItem } from './context.js';
import type { ResourceProofProvider } from './resource-observation.js';

export const EXTENSION_PROTOCOL_VERSION = 3 as const;
export const FeatureSchema = z.string().regex(/^[a-z][a-z0-9.-]{1,100}$/);
export const ExtensionIdSchema = z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/);
const requestId = z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/);
const actor = z.string().min(1).max(100);
export const WakeOriginSchema=z.strictObject({ kind: z.literal('wake'), producerId: ExtensionIdSchema, scheduleId: z.string().min(1).max(160), scheduleVersion: z.number().int().positive(), occurrenceId: requestId, dueAt: z.iso.datetime({ offset: true }) });
export const RunOriginSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('message'), inboundId: z.uuid(), conversation: ConversationSchema }),
  z.strictObject({ kind: z.literal('native'), producerId: ExtensionIdSchema, requestId }),
  WakeOriginSchema,
  z.strictObject({ kind: z.literal('continuation'), parentRunId: z.uuid(), checkpointId: z.uuid() }),
  z.strictObject({ kind: z.literal('maintenance'), producerId: ExtensionIdSchema, requestId }),
]);
export type RunOrigin = z.infer<typeof RunOriginSchema>;
export function taskScopeKey(agentId: string, taskId: string): string { return JSON.stringify(['dafeiyu-scope-v1', 'task', actor.parse(agentId), z.uuid().parse(taskId)]); }
export const ExecutionScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('conversation'), agentId: actor, route: z.string().min(1).max(2000) }),
  z.strictObject({ kind: z.literal('task'), agentId: actor, taskId: z.uuid(), scopeKey: z.string().max(2000) })
    .refine(value => value.scopeKey === JSON.stringify(['dafeiyu-scope-v1', 'task', value.agentId, value.taskId]), 'Invalid task scope key'),
]);
export type ExecutionScope = z.infer<typeof ExecutionScopeSchema>;
declare const executionGrantBrand: unique symbol;
export interface ExecutionGrant { readonly id: string; readonly [executionGrantBrand]: true }
export interface ExecutionContext {
  readonly agentId: string; readonly taskId: string | null; readonly runId: string; readonly operationId: string;
  readonly origin: RunOrigin; readonly scope: ExecutionScope; readonly intentVersion: number;
  readonly grant: ExecutionGrant; readonly signal: AbortSignal;
}
export interface ExecutionView {
  readonly runId: string; readonly taskId: string | null; readonly scope: ExecutionScope;
  readonly origin: RunOrigin; readonly signal: AbortSignal;
}
export interface ExecutionSourceRef { readonly id: string; readonly scopeKey: string; readonly version: number; readonly contentHash: string }
export const ActionOutcomeSchema = z.strictObject({
  status: z.enum(['succeeded', 'partial', 'failed', 'cancelled', 'unknown']),
  effects: z.enum(['none', 'confirmed', 'unknown']), completeness: z.enum(['complete', 'partial', 'unknown']),
  data: z.json(), sources: z.array(z.strictObject({ id: z.string().min(1).max(300), scopeKey: z.string().min(1).max(2000), version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/) })).max(64),
  receipts: z.array(z.strictObject({ id: z.string().min(1).max(256), kind: z.string().min(1).max(80) })).max(64),
  errorCode: z.string().regex(/^[A-Z0-9_]{1,100}$/).optional(),
});
export type ActionOutcome = z.infer<typeof ActionOutcomeSchema>;
export interface ActionCapability {
  readonly id: string; readonly version: string; readonly description: string;
  readonly inputSchema: z.ZodType; readonly outputSchema: z.ZodType;
  readonly effects: 'read' | 'local-write' | 'external-write'; readonly scope?: 'conversation'|'task'|'any';
  execute(input: Json, context: ExecutionContext): Promise<ActionOutcome>;
}
export interface TaskContextContributor {
  readonly id: string;
  prepare(view: ExecutionView): Promise<readonly ContextItem[]>;
  validate(view: ExecutionView, item: ContextItem): boolean;
}
export interface Extension {
  readonly protocolVersion:4; readonly id: string; readonly version: string; readonly agentId: string;
  readonly provides?: readonly string[]; readonly requires?: readonly string[];
  readonly actions?: readonly ActionCapability[]; readonly channels?: readonly ChannelCapability[];
  readonly contexts?: readonly TaskContextContributor[];
  readonly lifecycleReady?: () => boolean;
  readonly resourceProofs?: ResourceProofProvider;
  readonly conversationContexts?: readonly import('./context.js').ContextContributor[];
  readonly compactionProvider?: import('./compaction.js').CompactionProvider;
  readonly memoryObservationProvider?: import('./observation.js').MemoryObservationProvider;
}
export interface ExtensionHandle {
  ingest(message:unknown):Receipt;
  observe(event:import('./index.js').Observation):string;
  observeMemory(input:unknown,context?:import('./index.js').ConversationAccess):import('./observation.js').ObservationReceipt;
  openObservationSource(input:unknown,context?:import('./index.js').ConversationAccess):Record<string,unknown>;
  changeObservationSource(input:unknown,context?:import('./index.js').ConversationAccess):Record<string,unknown>;
  dispose():void;
}

export const ExtensionMetadataSchema = z.strictObject({ protocolVersion: z.literal(API_VERSION), id: ExtensionIdSchema,
  version: z.string().min(1).max(80), agentId: actor, provides: z.array(FeatureSchema).max(64).default([]), requires: z.array(FeatureSchema).max(64).default([]) });

export const TaskSubmitSchema = z.strictObject({ requestId, title: z.string().trim().min(1).max(200), goal: z.string().trim().min(1).max(2000),
  policyId: ExtensionIdSchema, inputRefs: z.array(z.string().min(1).max(300)).max(16).default([]),
  data:z.json().refine(value=>new TextEncoder().encode(JSON.stringify(value)).byteLength<=16384,'Task data exceeds 16 KiB').optional() });
