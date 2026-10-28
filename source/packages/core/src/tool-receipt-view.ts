import {runtimeHash} from './runtime-store.js';
import {z} from 'zod';
import {ActionOutcomeSchema,ExecutionToolReceiptSchema} from '@dafeiyu/contracts';

/** Shorten only confirmed, reopenable native results. No model summary and no action replay. */
export function toolReceiptView(text:string,meta:unknown,callId:string):string|null{
  const receipt=z.object({dafeiyuExecution:ExecutionToolReceiptSchema}).safeParse(meta);let raw:unknown;try{raw=JSON.parse(text);}catch{return null;}
  const parsed=ActionOutcomeSchema.safeParse(raw);if(!receipt.success||!parsed.success)return null;
  const proof=receipt.data.dafeiyuExecution,outcome=parsed.data;
  if(proof.callId!==callId||proof.outcomeHash!==runtimeHash(outcome)||!proof.sources.length||!['succeeded','partial'].includes(outcome.status)||outcome.effects==='unknown')return null;
  const view=JSON.stringify({...outcome,data:{kind:'archived-tool-result',operationId:proof.operationId,bodyOmitted:true,
    reopen:{action:'dafeiyu_execution_source_open',sources:proof.sources,offset:0,limit:2000},
    note:'此前已观察的完整结果仍在原来源。这里保留原操作状态和回执，正文需按引用重新读取；不要重新执行原工具，不把回执当成目标已满足。'}});
  return Buffer.byteLength(text)-Buffer.byteLength(view)>=512?view:null;
}
