import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import { MemoryBoundaryPolicySchema } from './memory-boundary.js';
import type { Conversation } from './index.js';
import { redactText } from './redaction.js';
const key=z.string().min(1).max(160).refine(v=>!/[\r\n]/.test(v)&&!redactText(v).redacted,'Observation identifiers must not contain credentials'),hash=z.string().regex(/^[a-f0-9]{64}$/);
const source=z.strictObject({key,occurredAt:z.iso.datetime({offset:true}),expectedVersion:z.number().int().positive().optional(),
  archive:z.discriminatedUnion('kind',[z.strictObject({kind:z.literal('text'),text:z.string().min(1).max(16000)}),z.strictObject({kind:z.literal('digest'),hash})]),
  policy:MemoryBoundaryPolicySchema.optional()});
const common={id:key,exposure:z.array(key).min(1).max(8),policy:MemoryBoundaryPolicySchema.optional()};
export const MemoryObservationSchema=z.strictObject({requestId:key,conversation:ConversationSchema,
  startedAt:z.iso.datetime({offset:true}),observedAt:z.iso.datetime({offset:true}),finishedAt:z.iso.datetime({offset:true}),
  outcome:z.enum(['completed','failed']),selection:z.strictObject({policyId:key,policyVersion:key,reasonCode:key}),
  counts:z.strictObject({received:z.number().int().nonnegative(),processed:z.number().int().nonnegative(),modelExposed:z.number().int().nonnegative()}),
  sources:z.array(source).max(8),exposedSources:z.array(key).max(8).default([]),contributions:z.array(z.discriminatedUnion('form',[
    z.strictObject({...common,form:z.literal('original'),source:key}),
    z.strictObject({...common,form:z.literal('fragment'),source:key,start:z.number().int().nonnegative(),end:z.number().int().positive(),text:z.string().min(1).max(8000)}),
    z.strictObject({...common,form:z.literal('summary'),text:z.string().min(1).max(8000)}),
  ])).max(8),
}).superRefine((v,c)=>{
  const ids=new Set(v.sources.map(s=>s.key));
  if(ids.size!==v.sources.length||new Set(v.contributions.map(x=>x.id)).size!==v.contributions.length||v.counts.processed>v.counts.received||v.counts.modelExposed>v.counts.processed
    ||Date.parse(v.startedAt)>Date.parse(v.observedAt)||Date.parse(v.observedAt)>Date.parse(v.finishedAt)||v.outcome==='failed'&&v.contributions.length
    ||new Set(v.exposedSources).size!==v.exposedSources.length||v.exposedSources.some(id=>!ids.has(id))||v.counts.modelExposed>0&&v.contributions.length>0&&!v.exposedSources.length
    ||v.sources.length>0&&v.counts.received===0||v.contributions.length>0&&v.counts.processed===0
    ||v.contributions.some(x=>new Set(x.exposure).size!==x.exposure.length||x.exposure.some(id=>!ids.has(id))||v.exposedSources.some(id=>!x.exposure.includes(id))||x.form!=='summary'&&(!ids.has(x.source)||!x.exposure.includes(x.source))))
    c.addIssue({code:'custom',message:'Invalid observation coverage or ordering'});
});
export type MemoryObservation=z.infer<typeof MemoryObservationSchema>;
export interface ObservationAuthority {agentId:string;route:string;pluginId:string;pluginVersion:string;ingressPluginId:string;conversation:Conversation;taskId:string|null;
  agentTaskId?:string;taskWorkId?:string;
  parent?:{traceId:string;operationId:string;eventId:string}}
export interface ObservationReceipt {activityId:string;sequence:number;eventId:string;duplicate:boolean;sources:{key:string;ref:string;version:number}[];
  contributions:{id:string;form:'original'|'fragment'|'summary';memoryId:string;revision:number;version:number}[];auditPending:boolean}
export const ObservationStoredReceiptSchema=z.strictObject({activityId:z.uuid(),sequence:z.number().int().positive(),eventId:z.uuid(),duplicate:z.boolean(),
  sources:z.array(z.strictObject({key,ref:z.string().regex(/^dafeiyu:observation-source:[a-f0-9-]{36}$/),version:z.number().int().positive()})).max(8),
  contributions:z.array(z.strictObject({id:key,form:z.enum(['original','fragment','summary']),memoryId:z.uuid(),revision:z.number().int().positive(),version:z.number().int().positive()})).max(8)});
export const ObservationSourceReadSchema=z.strictObject({conversation:ConversationSchema,ref:z.string().max(300),mode:z.enum(['normal','deleted']).default('normal'),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(4000).default(2000)});
export const ObservationSourceChangeSchema=z.strictObject({conversation:ConversationSchema,ref:z.string().max(300),requestId:key,expectedVersion:z.number().int().positive(),action:z.enum(['delete','restore'])});
export interface MemoryObservationProvider {
  submit(authority:ObservationAuthority,input:MemoryObservation):ObservationReceipt;
  open(authority:ObservationAuthority,input:z.output<typeof ObservationSourceReadSchema>):Record<string,unknown>;
  change(authority:ObservationAuthority,input:z.output<typeof ObservationSourceChangeSchema>):Record<string,unknown>;
}
