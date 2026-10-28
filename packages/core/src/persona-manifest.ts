import { PersonaManifestSchema } from '@dafeiyu/contracts';
import type { FoundationSnapshot } from './foundation.js';
import type { StoredRun } from './runtime-store.js';
import { runtimeHash } from './runtime-store.js';
/** Required seed fields of the memory projection; persisted self-understanding is added by the projection owner. */
export function foundationManifest(run:StoredRun,foundation:FoundationSnapshot,model:unknown){
  return PersonaManifestSchema.parse({schemaVersion:1,agentId:run.definition.scope.agentId,runId:run.id,foundationHash:foundation.version,foundationIdentity:foundation.fileIdentity,
    stageRevision:0,selectionVersion:0,stageStatus:'empty',entries:[],continuityCheckpointId:null,policyVersion:runtimeHash({kind:'memory-seed',version:1}),modelRouteHash:runtimeHash(model)});
}
