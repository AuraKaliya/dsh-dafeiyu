import { join } from 'node:path';
import { MemoryStore } from './store.js';
import { AnalysisStore } from './analysis-store.js';
import { WorkingStore } from './working-store.js';
import { FeedbackStore } from './feedback-store.js';
/** Initialize all authoritative memory state files in an already verified empty profile. */
export function initializeMemoryStorage(directory:string){
  const memory=new MemoryStore(join(directory,'memory.sqlite'));memory.close();
  const analysis=new AnalysisStore(join(directory,'analysis.sqlite'),true);analysis.close();
  const working=new WorkingStore(join(directory,'working.sqlite'));working.close();
  const feedback=new FeedbackStore(join(directory,'feedback.sqlite'));feedback.close();
}
