import { join } from 'node:path';
import { MemoryStore } from './store.js';
import { AnalysisStore } from './analysis-store.js';
import { WorkingStore } from './working-store.js';
/** Initialize all authoritative memory state files in an already verified empty profile. */
export function initializeMemoryStorage(directory:string,initial:{agentId:string;seed:import('@dafeiyu/contracts').PersonaSnapshot&{fileIdentity:string}}){
  const memory=new MemoryStore(join(directory,'memory.sqlite'));try{memory.autobiography(initial.agentId).foundation(()=>initial.seed);}finally{memory.close();}
  const analysis=new AnalysisStore(join(directory,'analysis.sqlite'),true);analysis.close();
  const working=new WorkingStore(join(directory,'working.sqlite'));working.close();
}
