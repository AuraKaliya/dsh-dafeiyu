import { z } from 'zod';

const part=z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('text'),text:z.string().min(1).max(32000).refine(text=>text.trim().length>0)}),
  z.strictObject({type:z.literal('media')}),
]);
export const QqMessageSequenceSchema=z.strictObject({qq_messages:z.array(part).min(1).max(12)})
  .refine(value=>value.qq_messages.filter(item=>item.type==='media').length<=1);
export const QQ_EXPRESSION_DEFAULTS='QQ是即时聊天：按一个完整意思组织每条消息，通常每条几句话，一轮可发1—4条，也可一条或纯表情；这是软建议，不强拆句、不机械轮流、不制造错别字。普通闲聊少用标题、编号和报告口吻；需要详细解释、文档或代码时保留必要细节。长任务在有必要让对方知道时用qq_progress表达意图、已核验进展或阻碍，不公开内部思考、不每次工具调用都播报。临时表达要求立即遵循；值得长期保留的表达偏好用dafeiyu_qq_expression_save保存，随后自动装配，不能只口头说记住。';
export const QQ_SEQUENCE_INSTRUCTIONS='需要分为多条QQ消息时，最终仅输出严格JSON：{"qq_messages":[{"type":"text","text":"第一条"},{"type":"text","text":"第二条"}]}。可在顺序中放一个{"type":"media"}表示已通过媒体／表情工具选定的部件发送位置，标记本身不发送；未写标记则媒体接在文字之后。普通单条可直接输出正文。不要把JSON包进代码围栏，不把尚未调用工具选定的图片写成已发送。';

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
