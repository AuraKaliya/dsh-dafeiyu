import {z} from 'zod';
import {API_VERSION} from './protocol.js';
import type {Json} from './index.js';

/** The UI renders source-owned sections. Configuration values never include credential contents. */
export interface ManagementField {path:string;label:string;kind:'text'|'number'|'boolean'|'lines'|'json'|'choices'|'select'|'time-windows'|'numbers';description:string;unit?:string;minimum?:number;maximum?:number;scale?:number;options?:readonly {value:string;label:string}[]}
export interface ManagementSection {id:string;title:string;description:string;fields:readonly ManagementField[];panel?:string;optionalPath?:string}
export interface PromptDescription {id:string;module:string;title:string;position:'system'|'context'|'history'|'tools';text?:string;dynamic?:true;condition:string}
export interface ManagementModule {id:string;title:string;description:string;tab:'personality'|'capabilities'|'runtime';sections:readonly ManagementSection[];prompts:readonly PromptDescription[]}
const moduleId=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ManagementRuntimeActionSchema=z.enum(['start','stop','restart','status']);
export type ManagementRuntimeAction=z.infer<typeof ManagementRuntimeActionSchema>;
/** Repeat requests reuse one operation. A retry never implies `start` created a new process. */
export const ManagementOperationIdSchema=z.string().uuid();
export const ManagementRequestSchema=z.discriminatedUnion('kind',[
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('describe')}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('save'),revision:z.string().length(64),changes:z.array(z.strictObject({module:moduleId,values:z.record(z.string().max(120),z.json())})).min(1).max(32)}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('runtime'),action:ManagementRuntimeActionSchema,operationId:ManagementOperationIdSchema.optional()}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('module'),module:moduleId,action:z.string().regex(/^[a-z][a-z.-]{0,63}$/),input:z.json()}),
]);
export type ManagementRequest=z.infer<typeof ManagementRequestSchema>;
export interface ManagementPort {request(action:string,input:Json):Json|Promise<Json>}
export const managementJson=(value:unknown):Json=>z.json().parse(value);

/** Lifecycle states are shared by the controller, the management protocol and the UI. */
export type ManagementLifecycleState='stopped'|'starting'|'waiting'|'running'|'stopping'|'failed';
/** Internal startup stages rendered with user-facing labels by the client. */
export type ManagementRuntimePhase='idle'|'configuration'|'qq'|'bridge'|'process'|'ready'|'stopping'|'stopped';
export type ManagementOperationDisposition='accepted'|'completed'|'rejected'|'failed';
export interface ManagementOperationSnapshot {id:string;action:'start'|'stop'|'restart';disposition:ManagementOperationDisposition;at:string;code:string|null}
export interface ManagementCapabilitySnapshot {id:string;state:string;owned:boolean;pid:number|null;code:string|null;message:string|null}
export interface ManagementActivitySnapshot {enabled:boolean;exploration:boolean;maintenance:boolean;plans:boolean}
/**
 * Read-only lifecycle snapshot. `instance` differentiates "a child process exists"
 * from "the instance answered ready over its own IPC channel".
 */
export interface ManagementRuntimeSnapshot {
  state:ManagementLifecycleState;
  phase:ManagementRuntimePhase;
  operationId:string|null;
  operation:ManagementOperationSnapshot|null;
  generation:number;
  pid:number|null;
  code:string|null;
  codeAt:string|null;
  /** Compatibility alias for older clients: same value as `code`. */
  retryAttempt:number;
  retry:{attempt:number;nextAt:string|null};
  checkedAt:string|null;
  startedAt:string|null;
  readyAt:string|null;
  instance:'absent'|'starting'|'unconfirmed'|'ready';
  error:{code:string;at:string}|null;
  /** Bounded diagnosis history: cleared as current state, retained for explanation. */
  history:readonly {code:string;at:string;phase:ManagementRuntimePhase}[];
  capabilities:readonly ManagementCapabilitySnapshot[];
  activity:ManagementActivitySnapshot|null;
}
/** A control request receipt: `accepted` never means the instance is already running. */
export interface ManagementControlResult extends ManagementRuntimeSnapshot {
  readonly action:ManagementRuntimeAction;
  readonly accepted:boolean;
  readonly disposition:ManagementOperationDisposition;
  readonly operationId:string|null;
  /** Read-only instance snapshot from its own IPC channel; null when unavailable. */
  readonly host:Json|null;
  readonly hostCode:string|null;
  /** Present when a request was refused before an operation could be reused. */
  readonly rejectCode?:string;
}
