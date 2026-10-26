import { existsSync,readFileSync,statSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
import { MEMORY_SCHEMA_VERSION } from '@dafeiyu/memory/store';
import type { PreparedHostConfig } from './configuration.js';
import { owners,processAlive } from './coordination.js';
const state=z.enum(['created','inspected','opening','binding','recovering','ready','degraded','draining','failed','stopped']);
const count=z.number().int().nonnegative(),hash=z.string().regex(/^[a-f0-9]{64}$/),id=z.string().regex(/^[a-z][a-z0-9._-]{0,99}$/);
const snapshotSchema=z.strictObject({schemaVersion:z.literal(1),profileId:id,agentId:z.string().min(1).max(100),instanceId:z.uuid(),pid:z.number().int().positive(),at:z.iso.datetime(),configHash:hash,foundationHash:hash,
  phase:state,mode:z.enum(['daemon','single-run']),accepting:z.boolean(),error:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),
  plugins:z.array(z.strictObject({id,required:z.boolean(),state:z.enum(['configured','starting','ready','degraded','disabled','not-configured','failed','stopped']),version:z.string().max(80).nullable(),code:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable()})).max(70),
  features:z.array(z.string().regex(/^[a-z][a-z0-9._-]{0,119}$/)).max(256),
  services:z.strictObject({memory:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),analysis:z.strictObject({state:z.enum(['ready','failed','paused','stopped','not-configured']),active:z.boolean()}),retrieval:z.enum(['configured','not-configured']),compaction:z.enum(['configured','not-configured']),sourceTracking:z.enum(['configured','not-configured']).optional(),maintenance:z.strictObject({state:z.enum(['ready','paused','closed','not-configured']),active:count,requests:z.record(z.string(),count),scheduler:z.enum(['not-configured','connected'])}).optional()}).nullable(),
    activity:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),running:z.boolean(),error:z.string().nullable(),counts:z.strictObject({plans:count,states:z.record(z.string(),count),occurrences:z.record(z.string(),count)})}).nullable().optional(),
    media:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),modalities:z.strictObject({vision:z.boolean(),asr:z.boolean(),events:z.boolean(),documents:z.boolean(),tts:z.boolean()}),counts:z.strictObject({sources:count,assets:count,bytes:count,drafts:count,exports:count,jobs:z.record(z.string(),count)}),reconciliation:z.strictObject({settled:count,pending:count,conflicts:count})}).nullable().optional(),
    bilibili:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),media:z.boolean(),counts:z.strictObject({pages:count,requests:count,pending:count}),backoffUntil:z.number().int().nonnegative().nullable()}).nullable().optional(),
    executor:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),active:count,counts:z.record(z.string(),count),mode:z.enum(['production','offline'])}).optional(),
    biliOwner:z.strictObject({lifecycle:z.enum(['registered','recovered','active','quiescing','closed']),accountUid:z.literal('170759822'),ownerUid:z.literal('13461350'),transport:z.literal('program-injected'),verified:z.boolean(),ingressHeld:z.boolean(),
      polling:z.boolean(),inFlight:count,lastPollAt:z.iso.datetime().nullable(),error:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),bindingFault:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable().optional(),backoffUntil:count,bindingReady:z.boolean(),counts:z.strictObject({inbound:z.record(z.string(),count),deliveries:z.record(z.string(),count)}),leaseEpoch:count.positive()}).optional(),
    taskDelivery:z.strictObject({total:count,pending:count,sent:count,partial:count,uncertain:count,blocked:count}).nullable().optional(),
    qq:z.strictObject({state:z.enum(['starting','online','offline','rejected','stopped']),groupSync:z.enum(['disabled','unavailable','current','stale']),groupError:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),effectiveGroups:count,lastGroupSync:z.iso.datetime().nullable(),capabilities:z.boolean().optional(),tasks:z.strictObject({enabled:z.boolean(),registered:z.boolean(),deliverResults:z.boolean()}).optional(),delivery:z.strictObject({plans:count,pending:count,unknown:count}).optional()}).nullable().optional()}),
  counts:z.strictObject({activeRuns:count,queuedRuns:count,queuedRoutes:count,pendingMessages:count,outbox:count}),schemas:z.strictObject({journal:z.literal(2),memory:z.union([z.literal(8),z.literal(9),z.literal(10),z.literal(11),z.literal(MEMORY_SCHEMA_VERSION)]),runtime:z.union([z.literal(2),z.literal(3),z.literal(4)]),activity:z.literal(1).nullable().optional(),media:z.literal(2).nullable().optional(),bilibili:z.literal(1).nullable().optional(),executor:z.literal(1).optional(),biliOwner:z.literal(1).optional()})});
export type SavedHostSnapshot=z.infer<typeof snapshotSchema>;
/** An old or edited file is evidence of a snapshot, never proof of a live healthy instance. */
export function readHostStatus(config:PreparedHostConfig,coordination?:string,now=Date.now()){
  const file=join(config.paths.core,'host-status.json');if(!existsSync(file))return {online:false,fresh:false,status:'not-running' as const,codes:['HOST_NO_STATUS'],snapshot:null};
  let snapshot:SavedHostSnapshot;try{if(statSync(file).size>131072)throw new Error();snapshot=snapshotSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(file))));}catch{throw new Error('HOST_STATUS_INVALID');}
  const codes:string[]=[],sameConfig=snapshot.profileId===config.config.profileId&&snapshot.agentId===config.config.agent.id&&snapshot.configHash===config.hash;
  if(!sameConfig)codes.push('HOST_STATUS_CONFIG_MISMATCH');const age=now-Date.parse(snapshot.at),fresh=age>=-5000&&age<=config.config.diagnostics.snapshotIntervalMs*3+1000;
  if(!fresh)codes.push(age<0?'HOST_STATUS_CLOCK_SKEW':'HOST_STATUS_STALE');
  const owner=owners(coordination).find(owner=>owner.instanceId===snapshot.instanceId&&owner.pid===snapshot.pid&&owner.profileId===snapshot.profileId&&owner.agentId===snapshot.agentId
    &&owner.resources.length===config.resources.length&&owner.resources.every((resource,index)=>resource.identity===config.resources[index]?.identity));
  const live=!!owner&&processAlive(snapshot.pid);if(!live)codes.push('HOST_STATUS_NOT_OWNED');
  const online=live&&sameConfig&&fresh&&snapshot.accepting&&['ready','degraded'].includes(snapshot.phase);
  return {online,fresh,status:online?'online' as const:live?'unhealthy' as const:'not-running' as const,codes,snapshot};
}
