import {z} from 'zod';
import {ConversationSchema} from '@dafeiyu/contracts';
import type {ActionOutcome} from '@dafeiyu/contracts';
/** Preserve bounded program receipts; model-authored descriptions remain labelled as local metadata or judgements. */
export function deliveryOperationFact(operation:{plugin:string;action:string;outcome:ActionOutcome|null}){
  const outcome=operation.outcome;if(!outcome)return null;
  const envelope={action:operation.action,status:outcome.status,effects:outcome.effects,errorCode:outcome.errorCode??null};
  if(operation.plugin==='qq-stickers'){
    const sticker=z.object({id:z.string(),version:z.number().optional(),name:z.string().optional(),scope:z.string().optional(),collectedAt:z.string().optional()});
    const parsed=z.object({id:z.string().optional(),version:z.number().optional(),name:z.string().optional(),scope:z.string().optional(),collectedAt:z.string().optional(),target:ConversationSchema.optional(),
      sticker:sticker.nullable().optional(),stickerId:z.string().optional(),stickerVersion:z.number().optional(),stickerName:z.string().optional(),receiptId:z.string().nullable().optional(),state:z.string().optional(),selected:z.number().optional(),sent:z.boolean().optional(),duplicate:z.boolean().optional(),draftId:z.string().optional()}).safeParse(outcome.data);
    if(!parsed.success)return null;return {kind:'reported' as const,text:JSON.stringify({...envelope,data:parsed.data,note:'程序保存的表情身份、选择和发送回执。名称属于库内标签，不证明图像含义。selected仅表示已选；只有state=sent且有receiptId才证明发到target，不代表对方已读。'})};
  }
  if(operation.plugin==='memory-execution'&&operation.action==='dafeiyu_task_object'){
    const parsed=z.object({id:z.string(),category:z.string(),blocking:z.boolean(),reason:z.string().max(1000),actions:z.array(z.string()).optional()}).safeParse(outcome.data);
    if(!parsed.success)return null;return {kind:'reported' as const,text:JSON.stringify({...envelope,objection:parsed.data,note:'程序记录了执行器提出的阻断原因，可如实转述为执行器判断；该判断本身不证明外部平台权限或故障。'})};
  }
  if(operation.plugin==='qq-capabilities'&&operation.action==='qq_groups'){
    const parsed=z.object({resources:z.array(z.object({scene:ConversationSchema,name:z.string().nullable().optional(),readable:z.boolean(),replyFromCurrentConversation:z.boolean(),replyViaAuthorizedGroupPatrol:z.boolean()}))}).safeParse(outcome.data);
    if(!parsed.success)return null;return {kind:'reported' as const,text:JSON.stringify({...envelope,...parsed.data,note:'当前读取及回复范围声明，不是平台发送成功或禁言证明。'})};
  }
  return null;
}
