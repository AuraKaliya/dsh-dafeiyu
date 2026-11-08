import { z } from 'zod';
import { outputContract } from './task-review.js';

const part=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('text'),text:z.string().min(1).max(32000).refine(text=>text.trim().length>0)}),
  z.strictObject({type:z.literal('media')}),
]);
export const QqMessageSequenceSchema=z.strictObject({qq_messages:z.array(part).min(1).max(12)})
  .refine(value=>value.qq_messages.filter(item=>item.type==='media').length<=1);
export const QQ_EXPRESSION_DEFAULTS='QQ是即时聊天：日常反馈优先一条简短消息，先给结论和最有用的信息。不要把结论、依据、限制和下一步固定拆成多条；没有新信息时不重复解释同一阻碍。可以多句或用空行保持一条消息，确有需要或用户要求时才分条，也可纯表情。不强拆句、不机械轮流、不制造错别字。普通闲聊少用标题、编号和报告口吻；详细解释、文档或代码保留必要细节。临时表达要求与当前场景优先；有价值的长期偏好可以选择保存并继续调整。';
export const QQ_SEQUENCE_INSTRUCTIONS='QQ最终回复使用 qq_messages 消息序列：每个 text 会实际发送一条消息。默认用一个text完成本轮回复，可以包含多句和换行；只有用户要求或确需分别发送时才用多个text，避免连续刷屏。只输出完整的契约JSON，不加外层解释；单条回复也使用一个text项。代码、引用和完整段落可保留必要长度。media只引用本轮实际选定的媒体部件，未指定时放在文字之后。序列是发送计划，不是成功回执；实际消息条数以随后提供的qq-delivery-counts中confirmed为准，pending、sending、unknown均不能当作已确认发送。\n'+JSON.stringify({kind:'channel-output-contract',schema:outputContract(QqMessageSequenceSchema)});

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
