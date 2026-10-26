import { createHash } from 'node:crypto';
import { z } from 'zod';
import { MediaVoiceEvidenceSchema,MediaAssetRefSchema } from '@dafeiyu/contracts';
import type { MediaExposure } from './store.js';
import type { MediaStore } from './store.js';
import { mediaHash } from './store.js';

const resultSchema=z.object({kind:z.literal('actual-audio-processing'),pcmSha256:z.string().length(64),sourceDurationMs:z.number().positive().max(120000),audioAsset:MediaAssetRefSchema,
  startMs:z.literal(0),endMs:z.number().positive(),requestedEndMs:z.number().positive(),technicalCompleteness:z.literal('complete'),speechDetected:z.literal(true),
  asr:z.object({status:z.literal('complete'),backend:z.literal('whisper.node'),version:z.literal('1.1.3'),modelSha256:z.string().length(64),segments:z.array(z.object({startMs:z.number().nonnegative(),endMs:z.number().nonnegative(),text:z.string()})).min(1)}),
  events:z.object({status:z.literal('complete'),backend:z.literal('yamnet-onnx'),modelSha256:z.string().length(64),labelsSha256:z.string().length(64),onnxruntimeVersion:z.string(),numpyVersion:z.string()})});

/** This derives a witness from persisted processing, never from model-authored transcript text. */
export function voiceWitness(store:MediaStore,exposure:MediaExposure){
  if(exposure.scope.kind!=='conversation'||exposure.assets.length!==1||!exposure.coverage.exposed)throw new Error('MEDIA_VOICE_INELIGIBLE');
  const source=store.source(exposure.sourceId);if(source.description.kind!=='audio')throw new Error('MEDIA_VOICE_INELIGIBLE');
  const parsed=resultSchema.safeParse(exposure.detail);if(!parsed.success)throw new Error('MEDIA_VOICE_INCOMPLETE');const detail=parsed.data,pcm=exposure.assets[0]!;
  const audio=store.assetWitness(detail.audioAsset),derived=store.assetWitness(pcm);
  if(audio.parent!==null||audio.processingHash!==null||audio.sourceId!==exposure.sourceId||mediaHash(derived.parent)!==mediaHash(detail.audioAsset))throw new Error('MEDIA_VOICE_SOURCE_NOT_WHOLE');
  if(pcm.kind!=='audio'||pcm.sha256!==detail.pcmSha256||detail.audioAsset.kind!=='audio'||Math.abs(detail.endMs-detail.sourceDurationMs)>2||detail.requestedEndMs<detail.sourceDurationMs-2)throw new Error('MEDIA_VOICE_INCOMPLETE');
  const text=detail.asr.segments.map(s=>s.text).join('').trim();if(!text||text.length>2200)throw new Error('MEDIA_VOICE_TRANSCRIPT_INVALID');
  const evidence=MediaVoiceEvidenceSchema.parse({schemaVersion:1,exposure:store.exposureProof(exposure),origin:source.description.origin,source:source.description.ref,audioAsset:detail.audioAsset,pcm,observation:store.observation(exposure.id),
    transcriptHash:createHash('sha256').update(text).digest('hex'),sourceDurationMs:detail.sourceDurationMs,
    asr:{backend:detail.asr.backend,version:detail.asr.version,modelSha256:detail.asr.modelSha256},events:{backend:detail.events.backend,modelSha256:detail.events.modelSha256,labelsSha256:detail.events.labelsSha256,onnxruntimeVersion:detail.events.onnxruntimeVersion,numpyVersion:detail.events.numpyVersion}});
  return {text,evidence};
}
