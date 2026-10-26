import { z } from 'zod';
import { ExecutionScopeSchema, ExtensionIdSchema } from './execution.js';
import { ResourceProofSchema } from './resource-observation.js';
import { PersonaRequestIdSchema, PersonaSourceRefSchema } from './persona.js';
export const MediaKindSchema = z.enum(['image', 'audio', 'video', 'document']);
const hash = z.string().regex(/^[a-f0-9]{64}$/), version = z.number().int().positive();
export const MediaProviderRefSchema = z.strictObject({ provider: ExtensionIdSchema, key: z.string().regex(/^[a-zA-Z0-9._:-]{1,240}$/) });
export const MediaSourceDescriptionSchema = z.strictObject({ ref: MediaProviderRefSchema, origin: ResourceProofSchema, kind: MediaKindSchema,
    name: z.string().max(200).refine(v => !/[\\/\x00-\x1f]/.test(v)).nullable(), mimeHint: z.string().max(120).nullable(),
    bytesHint: z.number().int().nonnegative().safe().nullable(), durationMsHint: z.number().int().nonnegative().safe().nullable(),
    rangeReadable: z.boolean(), publicContent: z.boolean().default(false) }).refine(v => v.ref.provider === v.origin.provider, 'Media source provider mismatch');
export const MediaAttachmentSchema = z.strictObject({ schemaVersion: z.literal(1), source: MediaProviderRefSchema, kind: MediaKindSchema, name: z.string().max(200).nullable() });
export const MediaAssetRefSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), version, kind: MediaKindSchema, sha256: hash, bytes: z.number().int().nonnegative().safe(), mime: z.string().min(1).max(120) });
export const MediaIntervalSchema = z.strictObject({ startMs: z.number().int().nonnegative(), endMs: z.number().int().positive() }).refine(v => v.endMs > v.startMs);
export const MediaCoverageSchema = z.strictObject({ acquiredBytes: z.number().int().nonnegative().safe(),
    processed: z.array(z.strictObject({ kind: z.enum(['image', 'frame', 'audio', 'page', 'paragraph', 'row']), start: z.number().nonnegative().finite(), end: z.number().nonnegative().finite(), unit: z.enum(['milliseconds', 'index', 'whole-image']) })).max(256),
    exposed: z.boolean(), gaps: z.array(z.string().max(500)).max(24), completeness: z.enum(['complete', 'partial', 'unknown']) });
export const MediaAssetRecordSchema = z.strictObject({ schemaVersion: z.literal(1), id: z.uuid(), version, agentId: z.string().min(1), scope: ExecutionScopeSchema, taskEpoch: version.nullable(),
    sourceId: z.uuid(), sourceVersion: version, kind: MediaKindSchema, state: z.enum(['staging', 'ready', 'evicted', 'deleted', 'failed']),
    sha256: hash.nullable(), bytes: z.number().int().nonnegative().safe().nullable(), mime: z.string().max(120).nullable(),
    parent: MediaAssetRefSchema.nullable(), processingHash: hash.nullable(), coverage: MediaCoverageSchema, createdAt: z.iso.datetime(), updatedAt: z.iso.datetime() });
export const MediaVoiceEvidenceSchema = z.strictObject({ schemaVersion: z.literal(1), exposure: ResourceProofSchema, origin: ResourceProofSchema,
    source: MediaProviderRefSchema, audioAsset: MediaAssetRefSchema, pcm: MediaAssetRefSchema, observation: PersonaSourceRefSchema,
    transcriptHash: hash, sourceDurationMs: z.number().positive().max(120000),
    asr: z.strictObject({ backend: z.literal('whisper.node'), version: z.literal('1.1.3'), modelSha256: hash }),
    events: z.strictObject({ backend: z.literal('yamnet-onnx'), modelSha256: hash, labelsSha256: hash, onnxruntimeVersion: z.string(), numpyVersion: z.string() }) });
export const NativeMediaMaterialSchema = z.strictObject({ draftId: z.uuid(), draftVersion: z.number().int().positive(), sourceStamp: hash,
    parts: z.array(z.discriminatedUnion('kind', [z.strictObject({ kind: z.literal('asset'), delivery: z.enum(['image', 'record', 'file']), asset: MediaAssetRefSchema, name: z.string().max(160).nullable() }), z.strictObject({ kind: z.literal('final-voice') })])).min(1).max(8) });
export const MediaAcquireSchema = z.strictObject({ requestId: PersonaRequestIdSchema, source: MediaProviderRefSchema });
export const MediaReadSchema = z.strictObject({ requestId: PersonaRequestIdSchema, asset: MediaAssetRefSchema.optional(), source: MediaProviderRefSchema.optional(),
    mode: z.enum(['inspect', 'image', 'frames', 'audio', 'document']), pointsMs: z.array(z.number().int().nonnegative()).max(8).optional(), interval: MediaIntervalSchema.optional(),
    offset: z.number().int().nonnegative().optional(), textOffset: z.number().int().nonnegative().optional(), limit: z.number().int().min(1).max(5000).optional() }).refine(v => !!v.asset !== !!v.source, 'Choose one asset or source')
    .refine(v => (v.mode === 'frames' ? !!v.pointsMs?.length : v.pointsMs === undefined) && (v.mode === 'audio' ? !!v.interval : v.interval === undefined) && (v.mode === 'document' || v.offset === undefined && v.textOffset === undefined && v.limit === undefined), 'Read options must match the selected mode');
