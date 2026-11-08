import {runtimeHash} from './runtime-store.js';
import {z} from 'zod';
import {ActionOutcomeSchema,ExecutionToolReceiptSchema,DshResultReadSchema} from '@dafeiyu/contracts';

const execution=z.object({isError:z.boolean().optional(),effect:z.enum(['none','confirmed','unknown']).optional(),receiptId:z.string().max(300).optional()});
const coverage=z.object({start:z.number().optional(),end:z.number().optional(),total:z.number().optional(),listedComplete:z.boolean().optional(),complete:z.boolean()});
/** Bounded facts survive even when a successful transport returned a failed command or partial page. */
function readingFacts(data:unknown):unknown{
  const outer=z.object({page:z.unknown().optional()}).safeParse(data),raw=outer.success&&outer.data.page!==undefined?outer.data.page:data;
  const batch=z.object({kind:z.literal('archived-result-batch'),items:z.array(z.object({status:z.enum(['ok','failed']),code:z.string().max(100).optional(),page:z.unknown().optional()})).max(8)}).safeParse(raw);
  if(batch.success)return {kind:batch.data.kind,items:batch.data.items.map(item=>({status:item.status,code:item.code??null,reading:readingFacts(item.page)}))};
  const page=z.object({resultId:z.uuid().optional(),path:z.array(z.string().max(1000)).max(32).optional(),execution:execution.optional(),view:z.object({coverage:coverage.optional(),entries:z.array(z.object({key:z.string(),value:z.unknown().optional()})).optional()}).optional()}).safeParse(raw);
  if(!page.success)return undefined;
  const commands=page.data.view?.entries?.flatMap(entry=>['exitCode','timedOut'].includes(entry.key)&&(['number','boolean'].includes(typeof entry.value)||entry.key==='exitCode'&&typeof entry.value==='string'&&/^-?\d{1,9}$/.test(entry.value))?[{key:entry.key,value:entry.value}]:[])??[];
  return {resultId:page.data.resultId??null,path:page.data.path??null,execution:page.data.execution??null,coverage:page.data.view?.coverage??null,commands};
}
/** Shorten only confirmed, reopenable native results. No model summary and no action replay. */
export function toolReceiptView(text:string,meta:unknown,callId:string,action:string):string|null{
  const receipt=z.object({dafeiyuExecution:ExecutionToolReceiptSchema}).safeParse(meta);let raw:unknown;try{raw=JSON.parse(text);}catch{return null;}
  const parsed=ActionOutcomeSchema.safeParse(raw);if(!receipt.success||!parsed.success)return null;
  const proof=receipt.data.dafeiyuExecution,outcome=parsed.data;
  if(proof.callId!==callId||proof.outcomeHash!==runtimeHash(outcome)||!proof.sources.length||!['succeeded','partial'].includes(outcome.status)||outcome.effects==='unknown')return null;
  // Observation references may expose metadata only. Do not promise raw reopening through them.
  if(!['dsh_tool_call','dsh_tool_read','dsh_result_read','dsh_result_read_batch'].includes(action))return null;
  const outer=z.object({page:z.unknown()}).safeParse(outcome.data);if(!outer.success)return null;
  const batch=z.object({kind:z.literal('archived-result-batch'),items:z.array(z.object({status:z.enum(['ok','failed']),page:z.unknown().optional()})).max(8)}).safeParse(outer.data.page);
  const pages=batch.success?batch.data.items.filter(item=>item.status==='ok').map(item=>item.page):[outer.data.page];
  const reads=pages.flatMap(raw=>{const page=z.object({resultId:z.uuid(),path:z.array(z.string()).optional(),read:DshResultReadSchema.optional(),handoff:z.unknown().optional(),processing:z.unknown().optional(),execution:z.object({receiptId:z.uuid(),effect:z.string().optional()}),view:z.object({coverage:z.object({start:z.number().int().nonnegative().optional()})})}).safeParse(raw);
    if(!page.success||page.data.execution.receiptId!==page.data.resultId||page.data.execution.effect==='unknown'||page.data.handoff!==undefined||page.data.processing!==undefined)return [];
    return [page.data.read??DshResultReadSchema.parse({resultId:page.data.resultId,path:page.data.path??[],offset:page.data.view.coverage.start??0})];});
  if(!reads.length||reads.length!==pages.length)return null;
  const view=JSON.stringify({...outcome,data:{kind:'archived-tool-result',operationId:proof.operationId,bodyOmitted:true,reading:readingFacts(outcome.data),
    reopen:{action:'dsh_result_read',reads},
    note:'此前实际暴露的结果页仍在原来源；未读部分仍未读。这里保留原操作状态、覆盖和回执，正文按引用回查；不要重执行原工具，不把回执当成目标已满足。'}});
  return Buffer.byteLength(text)-Buffer.byteLength(view)>=512?view:null;
}
