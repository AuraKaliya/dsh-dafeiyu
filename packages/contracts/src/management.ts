import {z} from 'zod';
import {API_VERSION} from './protocol.js';
import type {Json} from './index.js';

/** The UI renders source-owned sections. Configuration values never include credential contents. */
export interface ManagementField {path:string;label:string;kind:'text'|'number'|'boolean'|'lines'|'json'|'choices'|'select'|'time-windows'|'numbers';description:string;unit?:string;minimum?:number;maximum?:number;scale?:number;options?:readonly {value:string;label:string}[]}
export interface ManagementSection {id:string;title:string;description:string;fields:readonly ManagementField[];panel?:string;optionalPath?:string}
export interface PromptDescription {id:string;module:string;title:string;position:'system'|'context'|'history'|'tools';text?:string;dynamic?:true;condition:string}
export interface ManagementModule {id:string;title:string;description:string;tab:'personality'|'capabilities'|'runtime';sections:readonly ManagementSection[];prompts:readonly PromptDescription[]}
const moduleId=z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const ManagementRequestSchema=z.discriminatedUnion('kind',[
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('describe')}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('save'),revision:z.string().length(64),changes:z.array(z.strictObject({module:moduleId,values:z.record(z.string().max(120),z.json())})).min(1).max(32)}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('runtime'),action:z.enum(['start','stop','restart','status'])}),
  z.strictObject({apiVersion:z.literal(API_VERSION),kind:z.literal('module'),module:moduleId,action:z.string().regex(/^[a-z][a-z.-]{0,63}$/),input:z.json()}),
]);
export type ManagementRequest=z.infer<typeof ManagementRequestSchema>;
export interface ManagementPort {request(action:string,input:Json):Json|Promise<Json>}
export const managementJson=(value:unknown):Json=>z.json().parse(value);
