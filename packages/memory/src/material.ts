import type {PersonaAccess,PersonaSourceRef,PersonaSourceEvidence} from '@dafeiyu/contracts';
export interface PersonaMaterial {text:string;dependencies:PersonaSourceRef[];rootSources:string[];evidence?:PersonaSourceEvidence}
export type PersonaResolver=(access:PersonaAccess,ref:PersonaSourceRef)=>PersonaMaterial|null;
