import { z } from 'zod';
import { outputContract } from './task-review.js';

const part=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('text'),text:z.string().min(1).max(32000).refine(text=>text.trim().length>0)}),
  z.strictObject({type:z.literal('media')}),
]);
export const QqMessageSequenceSchema=z.strictObject({qq_messages:z.array(part).min(1).max(12)})
  .refine(value=>value.qq_messages.filter(item=>item.type==='media').length<=1);
export const QQ_EXPRESSION_DEFAULTS='QQ是即时聊天：按一个完整意思组织每条消息，每条通常一到两句话，可以一条、多条或纯表情；不强拆句、不机械轮流、不制造错别字，不要发送大段文本。普通闲聊少用标题、编号和报告口吻；需要详细解释、文档或代码时保留必要细节。阶段交流考虑对方的实际需要，说明有依据的进展和阻碍。临时表达要求与当前场景优先；有价值的长期偏好可以选择保存并继续调整。';
export const QQ_SEQUENCE_INSTRUCTIONS='QQ最终回复使用 qq_messages 消息序列：每个 text 是一条消息，按意思编排，每条通常一到两句话；一次回复可以发送多条，不要用空行代替分条。只输出完整的契约 JSON，不加外层解释；单条回复也使用一个 text 项。代码、引用和用户要求的完整段落可以保留必要长度。media 只引用本轮实际选定的媒体部件，未指定时放在文字之后。序列是发送计划，不是成功回执；实际消息条数以随后提供的 qq-delivery-counts 中 confirmed 为准，pending、sending、unknown 均不能当作已确认发送。\n'+JSON.stringify({kind:'channel-output-contract',schema:outputContract(QqMessageSequenceSchema)});

/** Only a complete, explicitly marked envelope changes transport semantics. Newlines remain prose. */
export function qqMessageSequence(raw:string):{messages:string[];mediaAt:number;structured:boolean}{
  const trimmed=raw.trim(),body=/^```(?:json)?\s*\r?\n?[\s\S]*\r?\n?```$/u.test(trimmed)?trimmed.replace(/^```(?:json)?\s*\r?\n?/u,'').replace(/\r?\n?```$/u,''):raw;
  if(!/^\s*\{\s*"qq_messages"\s*:/u.test(body))return {messages:raw?[raw]:[],mediaAt:raw?1:0,structured:false};
  let value:z.infer<typeof QqMessageSequenceSchema>;try{value=QqMessageSequenceSchema.parse(JSON.parse(body));}catch{throw new Error('QQ_MESSAGE_SEQUENCE_INVALID');}
  const messages:string[]=[];let mediaAt:number|undefined;
  for(const item of value.qq_messages)if(item.type==='text')messages.push(item.text);else mediaAt=messages.length;
  return {messages,mediaAt:mediaAt??messages.length,structured:true};
}
export const qqVisibleText=(raw:string)=>qqMessageSequence(raw).messages.join('\n\n');
