import type {Context} from '@deepseek-ai/cordis';
import type {StreamChunk} from '@deepseek-ai/dsh-llm';
import {visibleStream} from './visible-stream.js';
import type {RejectedModelInput} from './visible-stream.js';

export const ARGUMENT_REPAIR_CONTEXT='dafeiyu:argument-repair';

/** Repairs one rejected parameter shape without exposing its values or replaying completed tool operations. */
export class ModelInputRepair {
  private current:RejectedModelInput|undefined;
  private readonly attempted=new Set<string>();
  private audit:((event:RejectedModelInput)=>void)|undefined;
  constructor(scope:Context){
    scope.systemPrompt.context({name:ARGUMENT_REPAIR_CONTEXT,order:19,required:true,interpolate:false,text:()=>this.current?JSON.stringify({
      kind:'tool-argument-repair',tool:this.current.tool,fields:this.current.fields,reason:this.current.reason??'private-field',
      note:this.current.reason==='invalid-json'?'上一请求的工具参数不是合法JSON，该请求中的工具均未执行。请按当前schema生成完整JSON，正确使用双引号和转义，不输出半截参数；已完成的旧步骤保留，不要重做。':'上一模型请求的参数被程序拒绝，该请求中的工具均未执行。已完成的旧步骤仍保留，不要重做。请按当前工具schema修正参数，不传凭据或内部推理；分页使用返回的cursor字符串，不要包装token字段。不能把这次参数错误说成平台离线。',
    }):JSON.stringify({kind:'tool-argument-repair',state:'none'})});
    scope.on('agent/request-error',async(payload,next)=>{
      if(!['PRIVATE_INPUT_REJECTED','INVALID_MODEL_ARGUMENTS'].includes(payload.failure.code)||!this.current)return next();
      const signature=JSON.stringify([this.current.reason??'private-field',this.current.tool,this.current.fields.map(path=>path.replace(/\[\d+\]/g,'[]'))]);
      if(this.attempted.has(signature))return next();
      this.attempted.add(signature);return {kind:'retry' as const};
    });
  }
  begin(audit?:(event:RejectedModelInput)=>void){this.current=undefined;this.attempted.clear();this.audit=audit;}
  stream(input:AsyncIterable<StreamChunk>):AsyncIterable<StreamChunk>{return visibleStream(input,event=>{this.current=event;this.audit?.(event);});}
}
