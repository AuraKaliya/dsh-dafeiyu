import {z} from 'zod';
import {ExecutionScopeSchema,RunOriginSchema,ActionOutcomeSchema} from './execution.js';
import type {ExecutionScope,RunOrigin,ActionOutcome} from './execution.js';
import type {Json,PersonaSnapshot} from './index.js';

export const EpisodeStartSchema=z.strictObject({id:z.uuid(),scope:ExecutionScopeSchema,origin:RunOriginSchema,
  goal:z.string().max(32000),at:z.iso.datetime()});
export const EpisodeOperationSchema=z.strictObject({episodeId:z.uuid(),id:z.uuid(),action:z.string().min(1).max(160),
  outcome:ActionOutcomeSchema,at:z.iso.datetime()});
export const ReflectionInputSchema=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  episodeId:z.uuid().optional(),thought:z.string().trim().min(1).max(4000),
  uncertainty:z.string().max(2000).default(''),next:z.string().max(2000).default(''),
  basis:z.array(z.uuid()).max(32).default([])});
export const SelfUnderstandingInputSchema=z.strictObject({requestId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/),
  id:z.uuid().optional(),expectedVersion:z.number().int().nonnegative(),text:z.string().trim().min(1).max(4000),
  applicability:z.string().trim().min(1).max(1000),uncertainty:z.string().max(2000).default(''),
  reflections:z.array(z.uuid()).min(1).max(16)});
export const MemoryNoteRefSchema=z.strictObject({id:z.uuid(),version:z.number().int().positive()});
export interface ExperienceMemoryPort {
  begin(input:{id:string;scope:ExecutionScope;origin:RunOrigin;goal:string;at:string}):void;
  operation(input:{episodeId:string;id:string;action:string;outcome:ActionOutcome;at:string}):void;
  settle(episodeId:string,state:string):void;
  pending(scope:ExecutionScope):readonly Json[];
  foundation(seed:PersonaSnapshot&{fileIdentity:string}):PersonaSnapshot&{fileIdentity:string};
}
