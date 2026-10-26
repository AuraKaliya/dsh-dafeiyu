import { PersonaManifestSchema } from '@dafeiyu/contracts';
import type { FoundationSnapshot } from './foundation.js';
import type { StoredRun } from './runtime-store.js';
import { runtimeHash } from './runtime-store.js';
/** An explicit absence of the future stage provider is not a fabricated empty personality. */
export function foundationManifest(run:StoredRun,foundation:FoundationSnapshot,model:unknown){
  return PersonaManifestSchema.parse({schemaVersion:1,agentId:run.definition.scope.agentId,runId:run.id,foundationHash:foundation.version,foundationIdentity:foundation.fileIdentity,
    stageRevision:0,selectionVersion:0,stageStatus:'not-configured',entries:[],continuityCheckpointId:null,policyVersion:runtimeHash({kind:'foundation-only',version:1}),modelRouteHash:runtimeHash(model),assemblyVersion:'1'});
}
