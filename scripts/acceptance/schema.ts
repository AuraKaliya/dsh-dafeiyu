import {z} from 'zod';

const digest = z.string().regex(/^[a-f0-9]{64}$/);
const count = z.number().int().nonnegative().safe();
export const manifestSchema = z.strictObject({schemaVersion: z.literal(1), runId: z.uuid(), mode: z.literal('offline-sdk'),
  criteriaVersion: z.string(), revision: z.string().regex(/^[a-f0-9]{40}$/).nullable(), version: z.string(), apiVersion: count,
  sourceHash: digest, driverHash: digest, configHash: digest, catalogHash: digest, startedAt: z.iso.datetime(), scenarios: z.array(z.string()).min(1)});
export const completionSchema = z.strictObject({schemaVersion: z.literal(1), runId: z.uuid(), finishedAt: z.iso.datetime(),
  testExitCode: z.number().int(), sourceHash: digest, driverHash: digest, runtimeHash: digest, artifactHashes: z.record(z.string(), digest)});
export const artifactSchema = z.strictObject({schemaVersion: z.literal(1), runId: z.uuid(), scenarioId: z.string(), capturedAt: z.iso.datetime(),
  version: z.string(), apiVersion: count, sourceHash: digest, driverHash: digest, runtimeHash: digest, evidence: z.unknown()});
export type Manifest = z.infer<typeof manifestSchema>;
export type Completion = z.infer<typeof completionSchema>;

export const databaseEvidenceSchema = z.object({
  runs: z.array(z.object({id: z.string(), state: z.string(), definition: z.object({taskId: z.string().nullable(), intentVersion: count})})),
  deliveries: z.array(z.object({run_id: z.string(), state: z.string(), receipt: z.string().nullable(), body: z.string().nullable(),
    anchor: z.object({taskId: z.string(), target: z.object({kind: z.string(), id: z.string()})})})),
  requests: z.array(z.object({id: z.string(), body: z.object({sessionId: z.string().nullable(), phase: z.string()}),
    settlement: z.object({receipt: z.object({tokens: count.nullable()})}).nullable()})),
  operations: z.array(z.object({action: z.string(), outcome: z.object({status: z.string()}).nullable()})),
});

export const requestMeasurementSchema = z.object({sessionId: z.string().nullable(), inputBytes: count, toolResultBytes: count, repeatedToolResultBytes: count});
export const planSchema = z.object({body: z.object({id: z.string(), version: count, owner: z.object({kind: z.string(), taskId: z.string().optional()}),
  trigger: z.object({kind: z.literal('interval'), intervalMs: count}), watch: z.unknown(), quiet: z.array(z.unknown())}), status: z.string()});
