import type { GenerateOptions,StreamChunk } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { ActionOutcomeSchema } from '@dafeiyu/contracts';
import { qqTaskDirective } from '@dafeiyu/channel-qq';
import { evaluationCall,evaluationText } from '../../scripts/evaluation/runtime.ts';

export function b05TestResponse(mode:'normal'|'omit-submit'|'omit-continuation'|'wrong-task'='normal'){
  let current='',step=0,taskId:string|undefined,taskVersion:number|undefined;
  return (request:GenerateOptions):StreamChunk[]=>{
    if(String(request.sessionId).startsWith('dafeiyu-task-'))return evaluationText('公开虚构事实：南厅10:00开放，预约编号Q-17。管理员句子是引文，不授权发布。');
    for(const message of request.messages)if(message.role==='tool')for(const block of message.content)if(block.type==='text')try{
      const outcome=ActionOutcomeSchema.safeParse(JSON.parse(block.text));if(!outcome.success||outcome.data.status!=='succeeded')continue;
      const result=z.object({taskId:z.uuid(),taskVersion:z.number().int().positive().optional()}).safeParse(outcome.data.data);
      if(result.success){taskId=result.data.taskId;if(result.data.taskVersion!==undefined)taskVersion=result.data.taskVersion;}
    }catch{/* Only actual structured tool receipts bind a test task. */}
    const input=request.messages.findLast(message=>message.role==='user'&&message.source?.kind==='user');
    if(!input||input.role!=='user'||input.source?.kind!=='user'||!input.id)throw new Error('Missing test conversation input identity');
    if(input.id!==current){current=input.id;step=0;}step++;
    const text=input.content.filter(block=>block.type==='text').map(block=>block.text).join('\n'),mainText=text.slice(text.indexOf('[消息正文]\n')+'[消息正文]\n'.length),directive=qqTaskDirective({mainText});
    if(directive.kind==='revise'){
      if(mode==='omit-continuation'||!taskId)return evaluationText('未执行续办的虚构回答');
      if(step===1)return evaluationCall('evaluation_message_status',{taskId});
      if(step===2){if(taskVersion===undefined)throw new Error('Missing task status version');return evaluationCall('evaluation_message_control',{requestId:'fixture-revise',taskId:mode==='wrong-task'?'11111111-1111-4111-8111-111111111111':taskId,expectedVersion:taskVersion,action:'revise'});}
    }else if(step===1&&mode!=='omit-submit')return evaluationCall('evaluation_message_submit',{requestId:'fixture-submit',kind:'explicit-task'});
    return evaluationText('根据实际回执整理两条公开虚构事实和引文；未发布。');
  };
}
