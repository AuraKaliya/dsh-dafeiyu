import { z } from 'zod';
import { ActionOutcomeSchema, ExtensionMetadataV3Schema, dependencyOrder } from '@dafeiyu/contracts';
import type { ActionCapabilityV3, ExtensionV3, ExtensionHandleV3, ExecutionContextV3, ActionOutcome, Json, ContextContributorV3 } from '@dafeiyu/contracts';

interface ReservedNames { ids: readonly string[]; actions: readonly string[]; channels: readonly string[] }
export interface BoundActionV3 {
  readonly id: string; readonly owner: string; readonly version: string; readonly description: string;
  readonly input: Record<string, unknown>; readonly effects: ActionCapabilityV3['effects']; readonly requiresTask: boolean;
  readonly active: () => boolean;
  execute(raw: unknown, context: ExecutionContextV3): Promise<ActionOutcome>;
}
interface Entry {
  metadata: z.infer<typeof ExtensionMetadataV3Schema>; active: boolean;
  actions: readonly BoundActionV3[]; channels: readonly string[]; contexts: readonly ContextContributorV3[]; ready: () => boolean;
}
const allowedExtensionKeys = new Set(['protocolVersion', 'id', 'version', 'agentId', 'provides', 'requires', 'actions', 'channels', 'contexts', 'lifecycleReady']);
const actionMetaSchema = z.strictObject({ id: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), version: z.string().min(1).max(80),
  description: z.string().min(1).max(4000), effects: z.enum(['read', 'local-write', 'external-write']), requiresTask: z.boolean().default(false) });

function assertStrictSchema(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value)) { value.forEach(assertStrictSchema); return; }
  const object: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (object.type === 'object' && object.additionalProperties !== false && typeof object.additionalProperties !== 'object') throw new Error('V3_SCHEMA_MUST_BE_STRICT');
  Object.values(object).forEach(assertStrictSchema);
}
function freezeTree(value: unknown): void {
  if (!value || typeof value !== 'object') return;
  Object.values(value).forEach(freezeTree); Object.freeze(value);
}

/** Registration only. Core-issued execution authority is supplied by the later Run coordinator. */
export class CapabilityRegistryV3 {
  private readonly entries = new Map<string, Entry>();
  hasId(id: string): boolean { return this.entries.has(id); }
  actionNames(): string[] { return this.actions().map(action => action.id); }
  channelKeys(): string[] { return [...this.entries.values()].flatMap(entry => [...entry.channels]); }
  ids(): string[] { return [...this.entries.keys()]; }
  actions(): BoundActionV3[] { return [...this.entries.values()].filter(entry => entry.active).flatMap(entry => [...entry.actions]); }
  checkReady(available: readonly string[] = []): void {
    dependencyOrder([...this.entries.values()].filter(entry => entry.active).map(entry => entry.metadata), available);
    if ([...this.entries.values()].some(entry => entry.active && !entry.ready())) throw new Error('DEPENDENCY_UNAVAILABLE');
  }
  register(agentId: string, extension: ExtensionV3, reserved: ReservedNames): ExtensionHandleV3 {
    if (Object.keys(extension).some(key => !allowedExtensionKeys.has(key))) throw new Error('INVALID_EXTENSION_FIELD');
    const metadata = ExtensionMetadataV3Schema.parse({ protocolVersion: extension.protocolVersion, id: extension.id, version: extension.version,
      agentId: extension.agentId, provides: extension.provides ?? [], requires: extension.requires ?? [] });
    if (metadata.agentId !== agentId) throw new Error('INCOMPATIBLE_AGENT');
    if (this.entries.has(metadata.id) || reserved.ids.includes(metadata.id)) throw new Error('DUPLICATE_EXTENSION');
    const names = new Set([...reserved.actions, ...this.actionNames()]), channels = new Set([...reserved.channels, ...this.channelKeys()]);
    if(extension.lifecycleReady!==undefined&&typeof extension.lifecycleReady!=='function')throw new Error('INVALID_EXTENSION_CONTRACT');
    const entry: Entry = { metadata, active: true, actions: [], channels: [], contexts: [], ready: extension.lifecycleReady?.bind(extension) ?? (() => true) };
    const bound: BoundActionV3[] = [];
    for (const action of extension.actions ?? []) {
      const meta = actionMetaSchema.parse({ id: action.id, version: action.version, description: action.description, effects: action.effects, requiresTask: action.requiresTask ?? false });
      if (names.has(meta.id)) throw new Error('DUPLICATE_ACTION'); names.add(meta.id);
      if (!(action.inputSchema instanceof z.ZodType) || !(action.outputSchema instanceof z.ZodType) || typeof action.execute !== 'function') throw new Error('INVALID_ACTION_CONTRACT');
      const input = structuredClone(z.toJSONSchema(action.inputSchema, { io: 'input' }));
      if (input.type !== 'object' || input.additionalProperties !== false) throw new Error('V3_SCHEMA_MUST_BE_STRICT');
      assertStrictSchema(input);
      freezeTree(input);
      const parseInput = action.inputSchema.parse.bind(action.inputSchema), parseOutput = action.outputSchema.parse.bind(action.outputSchema), execute = action.execute.bind(action);
      bound.push(Object.freeze({ ...meta, owner: metadata.id, input: Object.freeze(input), active: () => entry.active,
        execute: async (raw: unknown, context: ExecutionContextV3) => {
          if (!entry.active || !entry.ready()) throw new Error('CAPABILITY_UNAVAILABLE');
          context.signal.throwIfAborted();
          if (meta.requiresTask && !context.taskId) throw new Error('TASK_REQUIRED');
          const parsed: Json = z.json().parse(parseInput(raw));
          if (Buffer.byteLength(JSON.stringify(parsed), 'utf8') > 128000) throw new Error('ACTION_INPUT_TOO_LARGE');
          const result = ActionOutcomeSchema.parse(await execute(parsed, context));
          if (result.data !== null) result.data = z.json().parse(parseOutput(result.data));
          context.signal.throwIfAborted();
          if (!entry.active) throw new Error('CAPABILITY_UNAVAILABLE');
          return result;
        } }));
    }
    const keys: string[] = [];
    for (const channel of extension.channels ?? []) {
      const key = JSON.stringify([channel.channel, channel.account]);
      if (!channel.channel || !channel.account || typeof channel.deliver !== 'function' || channels.has(key)) throw new Error('DUPLICATE_OR_INVALID_CHANNEL');
      channels.add(key); keys.push(key);
    }
    if (new Set(metadata.provides).size !== metadata.provides.length || new Set(metadata.requires).size !== metadata.requires.length) throw new Error('DUPLICATE_FEATURE');
    const existingFeatures = new Set([...this.entries.values()].flatMap(value => value.metadata.provides));
    if (metadata.provides.some(feature => existingFeatures.has(feature))) throw new Error('DUPLICATE_FEATURE');
    const contextIds = new Set<string>();
    entry.contexts = (extension.contexts ?? []).map(context => {
      if(!/^[a-z][a-z0-9._-]{0,79}$/.test(context.id)||contextIds.has(context.id)||typeof context.prepare!=='function'||typeof context.validate!=='function')throw new Error('INVALID_CONTEXT_CONTRACT');
      contextIds.add(context.id);return Object.freeze({id:context.id,prepare:context.prepare.bind(context),validate:context.validate.bind(context)});
    });
    entry.actions = bound; entry.channels = keys;
    this.entries.set(metadata.id, entry);
    return Object.freeze({ dispose: () => { if (!entry.active) return; entry.active = false; this.entries.delete(metadata.id); } });
  }
  close(): void { for (const entry of this.entries.values()) entry.active = false; this.entries.clear(); }
}
