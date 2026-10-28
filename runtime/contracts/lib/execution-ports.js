import { z } from 'zod';
import { TaskCreateSchema, TaskUpdateSchema } from './task-workspace.js';
import { ExtensionIdSchema, RunOriginSchema, TaskSubmitSchema, WakeOriginSchema } from './execution.js';
import { PersonaSourceRefSchema } from './persona.js';
export const TaskStateSchema = z.strictObject({ id: z.uuid(), agentId: z.string().min(1), version: z.number().int().positive(),
    epoch: z.number().int().positive(), status: z.enum(['active', 'paused', 'completed']), title: z.string().max(200), goal: z.string().max(2000) });
export const ExecutionInputSchema = z.strictObject({ id: z.string().min(1).max(300), scopeKey: z.string().min(1).max(2000),
    version: z.number().int().positive(), contentHash: z.string().regex(/^[a-f0-9]{64}$/), text: z.string().max(32000),
    proofHash: z.string().regex(/^[a-f0-9]{64}$/), kind: z.enum(['selected-memory', 'execution-source']),
    sourceRef: PersonaSourceRefSchema.optional(), rootSources: z.array(z.string().min(1).max(2200)).max(64).optional() });
export const ExistingTaskRequestSchema = TaskSubmitSchema.omit({ title: true, goal: true }).extend({ taskId: z.uuid(), expectedVersion: z.number().int().positive() });
export const ExecutionRequestSchema = z.union([TaskSubmitSchema, ExistingTaskRequestSchema]);
export const RunControlSchema = z.strictObject({ requestId: z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/), expectedVersion: z.number().int().positive(), reason: z.string().min(1).max(300) });
export const ResumeRunSchema = ExistingTaskRequestSchema.extend({ parentRunId: z.uuid(), checkpointId: z.uuid() });
export const WakeRequestSchema = ExistingTaskRequestSchema.extend({ origin: WakeOriginSchema });
/** Trusted wake purpose; it describes this run without changing its task or authority. */
export const WakeWorkSchema = z.strictObject({ kind: z.literal('memory-maintenance'), requestId: z.uuid(), goal: z.string().min(1).max(2000) });
export const ProducerSchema = ExtensionIdSchema;
