import { z } from 'zod';
import { ConversationSchema } from './conversation.js';
import type { Conversation } from './conversation.js';
import type { PersonaAccess, PersonaSourceRef } from './persona.js';
import type { TimelineScope } from './history.js';

export const ResourceProofSchema = z.strictObject({ provider: z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/), scene: ConversationSchema,
  key: z.string().min(1).max(240), version: z.number().int().positive(), hash: z.string().regex(/^[a-f0-9]{64}$/),
  roots:z.array(z.string().min(1).max(600)).min(1).max(64),detail: z.json() }).refine(value=>JSON.stringify(value.detail).length<=16000);
export type ResourceProof = z.infer<typeof ResourceProofSchema>;
/** Owned by the registered capability, used only to verify persisted source facts. */
export interface ResourceProofProvider { current(proof: ResourceProof): boolean; epoch(scope?:TimelineScope): string }
export const CapabilityObservationSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), proof: ResourceProofSchema,
  text: z.string().min(1).max(8000), occurredAt: z.iso.datetime(), coverage: z.array(z.string().max(300)).max(24),
  counts: z.strictObject({ received: z.number().int().nonnegative(), processed: z.number().int().nonnegative() }) })
  .refine(value => value.counts.processed <= value.counts.received);
export const CapabilitySelectionSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), observationId: z.uuid(),
  version: z.number().int().positive(), mode: z.enum(['none', 'original', 'fragment', 'summary']),
  start: z.number().int().nonnegative().optional(), end: z.number().int().positive().optional(), text: z.string().trim().min(1).max(8000).optional(),
  reason: z.string().trim().min(1).max(500) });
export interface CapabilityObservationAccess { readonly execution: PersonaAccess; readonly scene: Conversation; readonly guard: () => void }
export interface CapabilityObservationPort {
  ready(): boolean;
  record(access: CapabilityObservationAccess, input: z.output<typeof CapabilityObservationSchema>): { source: PersonaSourceRef; duplicate: boolean };
  select(access: CapabilityObservationAccess, input: z.output<typeof CapabilitySelectionSchema>, actualView: string): Record<string, unknown>;
  valid(scope: TimelineScope, source: PersonaSourceRef, exposedHash?: string): boolean;
}
