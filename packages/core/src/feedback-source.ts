import type { Journal } from '@dafeiyu/journal';
import type { TaskRepositoryPort } from '@dafeiyu/contracts';
import type { FeedbackRecord } from './feedback-ledger.js';

export interface FeedbackSourcePorts {
  readonly journal:Pick<Journal,'get'|'messageRecalled'>;
  readonly repository:Pick<TaskRepositoryPort,'readState'>;
  readonly agentId:string;
}

/** The original inbound and task epoch authorize a delayed feedback send. */
export function feedbackSourceCurrent(record:FeedbackRecord,ports:FeedbackSourcePorts):boolean {
  if(!record.sourceMessageId)return false;
  try{
    const item=ports.journal.get(record.sourceMessageId);
    if(item.route!==record.route)return false;
    if(ports.journal.messageRecalled({agentId:ports.agentId,route:record.route},record.sourceMessageId))return false;
    if(record.taskId&&record.intentVersion!==undefined){
      const task=ports.repository.readState(ports.agentId,record.taskId);
      if(task.epoch!==record.intentVersion)return false;
    }
    return true;
  }catch{return false;}
}
