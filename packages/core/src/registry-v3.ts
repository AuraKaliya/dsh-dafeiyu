import { z } from 'zod';
import { ActionOutcomeSchema, ExtensionMetadataV3Schema, dependencyOrder,redactJson,ResourceTargetViewSchema } from '@dafeiyu/contracts';
import type { Conversation,ExecutionScope,ResourceTargetView } from '@dafeiyu/contracts';
import type { ActionCapabilityV3, ExtensionV3, ExtensionHandleV3, ExecutionContextV3, ActionOutcome, Json, ContextContributorV3, ResourceProof, ResourceProofProvider, TimelineScope } from '@dafeiyu/contracts';
import { toolParameters } from './tool-schema.js';

interface ReservedNames { ids: readonly string[]; actions: readonly string[]; channels: readonly string[] }
export interface BoundActionV3 {
  readonly id: string; readonly owner: string; readonly version: string;readonly pluginVersion:string; readonly description: string;
  readonly input: Record<string, unknown>; readonly effects: ActionCapabilityV3['effects']; readonly requiresTask: boolean;
  readonly parameters:ReturnType<typeof toolParameters>;
  readonly active: () => boolean;
  readonly signal:AbortSignal;
  validateInput(raw:unknown):Json;
  execute(raw: unknown, context: ExecutionContextV3): Promise<ActionOutcome>;
}
interface Entry {
  metadata: z.infer<typeof ExtensionMetadataV3Schema>; active: boolean;controller:AbortController;
  actions: readonly BoundActionV3[]; channels: readonly string[]; contexts: readonly ContextContributorV3[]; ready: () => boolean;
  resourceProofs?: ResourceProofProvider;
}
const allowedExtensionKeys = new Set(['protocolVersion', 'id', 'version', 'agentId', 'provides', 'requires', 'actions', 'channels', 'contexts', 'lifecycleReady', 'resourceProofs']);
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

/** Registration snapshots. Invocation authority is issued by the core Run coordinator. */
export class CapabilityRegistryV3 {
  private resourceState(entry:Entry,scope?:TimelineScope){try{const epoch=entry.resourceProofs?.epoch(scope);return typeof epoch==='string'&&epoch.length<=8000?{ready:entry.active&&entry.ready(),epoch}:{ready:false,epoch:'INVALID_RESOURCE_EPOCH'};}catch{return {ready:false,epoch:'RESOURCE_UNAVAILABLE'};}}
  resourceCurrent(proof:ResourceProof):boolean {const entry=this.entries.get(proof.provider);try{return !!entry&&this.resourceState(entry).ready&&entry.resourceProofs?.current(proof)===true;}catch{return false;}}
  publicView(proof:ResourceProof,view:string):boolean {const entry=this.entries.get(proof.provider);try{return this.resourceCurrent(proof)&&entry?.resourceProofs?.publicView?.(proof,view)===true;}catch{return false;}}
  targetView(proof:ResourceProof,view:string,target:Conversation,scope:ExecutionScope):ResourceTargetView|null {
    const entry=this.entries.get(proof.provider);try{if(!this.resourceCurrent(proof)||!entry?.resourceProofs?.targetView)return null;
      const result=entry.resourceProofs.targetView(proof,view,target,scope);if(result===null)return null;
      const parsed=ResourceTargetViewSchema.safeParse(result);return parsed.success&&this.resourceCurrent(proof)?Object.freeze(parsed.data):null;
    }catch{return null;}
  }
  resourceEpoch(scope?:TimelineScope,excluding?:string):string{return JSON.stringify([...this.entries.values()].filter(entry=>entry.active&&entry.resourceProofs&&entry.metadata.id!==excluding).flatMap(entry=>{const state=this.resourceState(entry,scope);return state.epoch===''?[]:[[entry.metadata.id,state]];}));}
  contributors(){return [...this.entries.values()].filter(entry=>entry.active&&entry.ready()).flatMap(entry=>entry.contexts.map(context=>({owner:entry.metadata.id,version:entry.metadata.version,context,active:()=>entry.active&&entry.ready(),signal:entry.controller.signal})));}
  private readonly entries = new Map<string, Entry>();
  hasId(id: string): boolean { return this.entries.has(id); }
  actionNames(): string[] { return this.actions().map(action => action.id); }
  channelKeys(): string[] { return [...this.entries.values()].flatMap(entry => [...entry.channels]); }
  ids(): string[] { return [...this.entries.keys()]; }
  contexts(){return [...this.entries.values()].filter(entry=>entry.active).flatMap(entry=>entry.contexts.map(context=>({owner:entry.metadata.id,context,active:()=>entry.active&&entry.ready()})));}
  actions(): BoundActionV3[] { return [...this.entries.values()].filter(entry => entry.active).flatMap(entry => [...entry.actions]); }
  providedFeatures(): string[] { return [...this.entries.values()].filter(entry => entry.active && entry.ready()).flatMap(entry => entry.metadata.provides); }
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
    const entry: Entry = { metadata, active: true, controller:new AbortController(),actions: [], channels: [], contexts: [], ready: extension.lifecycleReady?.bind(extension) ?? (() => true) };
    if(extension.resourceProofs){if(typeof extension.resourceProofs.current!=='function'||typeof extension.resourceProofs.epoch!=='function')throw new Error('INVALID_EXTENSION_CONTRACT');
      if(extension.resourceProofs.publicView!==undefined&&typeof extension.resourceProofs.publicView!=='function')throw new Error('INVALID_EXTENSION_CONTRACT');
      if(extension.resourceProofs.targetView!==undefined&&typeof extension.resourceProofs.targetView!=='function')throw new Error('INVALID_EXTENSION_CONTRACT');
      entry.resourceProofs=Object.freeze({current:extension.resourceProofs.current.bind(extension.resourceProofs),epoch:extension.resourceProofs.epoch.bind(extension.resourceProofs),...(extension.resourceProofs.publicView?{publicView:extension.resourceProofs.publicView.bind(extension.resourceProofs)}:{}),...(extension.resourceProofs.targetView?{targetView:extension.resourceProofs.targetView.bind(extension.resourceProofs)}:{})});}
    const bound: BoundActionV3[] = [];
    for (const action of extension.actions ?? []) {
      const meta = actionMetaSchema.parse({ id: action.id, version: action.version, description: action.description, effects: action.effects, requiresTask: action.requiresTask ?? false });
      if (names.has(meta.id)) throw new Error('DUPLICATE_ACTION'); names.add(meta.id);
      if (!(action.inputSchema instanceof z.ZodType) || !(action.outputSchema instanceof z.ZodType) || typeof action.execute !== 'function') throw new Error('INVALID_ACTION_CONTRACT');
      const input = structuredClone(z.toJSONSchema(action.inputSchema, { io: 'input' }));
      if (input.type !== 'object' || input.additionalProperties !== false) throw new Error('V3_SCHEMA_MUST_BE_STRICT');
      assertStrictSchema(input);
      freezeTree(input);
      const parameters=toolParameters(input);freezeTree(parameters);
      const parseInput = action.inputSchema.parse.bind(action.inputSchema), parseOutput = action.outputSchema.parse.bind(action.outputSchema), execute = action.execute.bind(action);
      const validateInput=(raw:unknown):Json=>{let parsed:Json;try{parsed=z.json().parse(parseInput(raw));}catch{throw new Error('INVALID_INPUT');}if(Buffer.byteLength(JSON.stringify(parsed),'utf8')>128000)throw new Error('ACTION_INPUT_TOO_LARGE');return parsed;};
      bound.push(Object.freeze({ ...meta, owner: metadata.id,pluginVersion:metadata.version, input: Object.freeze(input),parameters, signal:entry.controller.signal,active: () => entry.active&&entry.ready(),validateInput,
        execute: async (raw: unknown, context: ExecutionContextV3):Promise<ActionOutcome> => {
          if (!entry.active || !entry.ready()) throw new Error('CAPABILITY_UNAVAILABLE');
          context.signal.throwIfAborted();
          if (meta.requiresTask && !context.taskId) throw new Error('TASK_REQUIRED');
          const parsed=validateInput(raw);
          const result = ActionOutcomeSchema.parse(await execute(parsed, context));
          if (result.data !== null) result.data = z.json().parse(parseOutput(result.data));
          // Preserve a returned receipt even if cancellation/unload arrived while the operation ran.
          // The coordinator persists the fact before checking continued admission.
          if(Buffer.byteLength(JSON.stringify(result),'utf8')>128000)throw new Error('ACTION_RESULT_TOO_LARGE');
          if(redactJson(z.json().parse(result)).redacted)return {status:'partial',effects:result.effects,completeness:'partial',data:null,sources:[],receipts:[],errorCode:'PRIVATE_CONTENT_OMITTED'};
          return result;
        } }));
    }
    const keys: string[] = [];
    for (const channel of extension.channels ?? []) {
      if(channel.processingSignal!==undefined&&typeof channel.processingSignal!=='function')throw new Error('INVALID_DELIVERY_CONTRACT');
      if(channel.taskDelivery!==undefined&&channel.taskDelivery!=='simulated')throw new Error('INVALID_DELIVERY_CONTRACT');
      if(channel.deliveryValidation!==undefined&&channel.deliveryValidation!=='per-segment')throw new Error('INVALID_DELIVERY_CONTRACT');
      if(channel.deliverTaskResult!==undefined&&typeof channel.deliverTaskResult!=='function')throw new Error('INVALID_DELIVERY_CONTRACT');
      if(channel.mediaDelivery!==undefined&&(channel.mediaDelivery!=='parts-v1'||channel.deliveryValidation!=='per-segment'||typeof channel.deliverMedia!=='function')||channel.deliverMedia!==undefined&&channel.mediaDelivery!=='parts-v1')throw new Error('INVALID_DELIVERY_CONTRACT');
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
    return Object.freeze({ dispose: () => { if (!entry.active) return; entry.active = false; entry.controller.abort();this.entries.delete(metadata.id); } });
  }
  close(): void { for (const entry of this.entries.values()){entry.active = false;entry.controller.abort();} this.entries.clear(); }
}
