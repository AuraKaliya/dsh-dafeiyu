import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {Context} from '@deepseek-ai/cordis';
import LlmRuntime,{createSystemMessage,createUserMessage,ReasoningEffortId} from '@deepseek-ai/dsh-llm';
import Credentials from '@deepseek-ai/dsh-credentials-local';
import {SessionId} from '@deepseek-ai/dsh-session';
import {HostConfigSchema,NativeExpressionPacketSchema} from '@dafeiyu/contracts';
import {installInlineDeepSeek} from '../packages/host/lib/inline-model.js';
import {DeepSeekConfigSchema} from '../packages/host/lib/configuration.js';
import {DELIVERY_VERIFICATION_INSTRUCTIONS,deliveryVerificationBody} from '../packages/memory/lib/expression-runtime.js';
import {z} from 'zod';

// Explicit opt-in real-provider acceptance. Default test runs never read credentials or call a model.
const inputFile=process.env.DAFEIYU_REAL_VERIFIER_INPUT;
test('explicit real verifier accepts supported wording and rejects a changed visible fact',{skip:!inputFile,timeout:210000},async()=>{
  const input=z.object({hostFile:z.string(),packet:NativeExpressionPacketSchema,cases:z.array(z.object({id:z.string(),text:z.string(),expected:z.boolean()})).min(2).max(3),outputFile:z.string()}).parse(JSON.parse(readFileSync(inputFile!,'utf8')));
  const config=HostConfigSchema.parse(JSON.parse(readFileSync(input.hostFile,'utf8'))),model=DeepSeekConfigSchema.parse(config.plugins.find(plugin=>plugin.id==='model-deepseek')?.config),route=config.modelRoutes.chat;
  assert.notEqual(model.auth,'dsh-account');assert.ok(model.inlineTransport);
  const digest=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex'),credentialStamp=digest(readFileSync(model.credentialStore)),guard=()=>{if(digest(readFileSync(model.credentialStore))!==credentialStamp)throw new Error('CREDENTIAL_STORE_CHANGED');};
  const ctx=new Context(),results:unknown[]=[];
  try{await ctx.plugin(LlmRuntime);await ctx.plugin(Credentials,{path:model.credentialStore,watch:false});await installInlineDeepSeek(ctx,{baseURL:model.baseURL,credentialName:model.credentialName,route,settings:model.inlineTransport,credentialGuard:guard});
    const info=await ctx.llm.resolveModelInfo(route.provider,route.model);assert.ok(info.reasoning?.efforts.some(effort=>effort.id==='off'));
    for(const sample of input.cases){const started=Date.now(),signal=AbortSignal.timeout(60000);let output='',finish='',firstTextMs:number|null=null;
      try{for await(const chunk of ctx.llm.stream({provider:route.provider,model:route.model,reasoningEffort:ReasoningEffortId('off'),temperature:0,maxTokens:8192,sessionId:SessionId('verifier-acceptance-'+randomUUID()),signal,tools:[],messages:[
        createSystemMessage(DELIVERY_VERIFICATION_INSTRUCTIONS),
        createUserMessage({source:{kind:'user'},content:[{type:'text',text:JSON.stringify(deliveryVerificationBody({question:input.packet.question,evidence:input.packet.evidence},sample.text))}]})]})){
        if(chunk.type==='text-delta'&&firstTextMs===null)firstTextMs=Date.now()-started;
        if(chunk.type==='block-end'&&chunk.block.type==='text')output+=chunk.block.text;
        if(chunk.type==='finish')finish=chunk.reason.kind;
      }
      const verdict=z.strictObject({faithful:z.boolean(),issues:z.array(z.string()).max(16)}).parse(JSON.parse(output.trim().replace(/^```(?:json)?\s*/u,'').replace(/\s*```$/u,'')));
      results.push({id:sample.id,elapsedMs:Date.now()-started,firstTextMs,finish,verdict,candidateHash:digest(sample.text)});
      }catch(error){results.push({id:sample.id,elapsedMs:Date.now()-started,firstTextMs,finish,error:error instanceof Error?error.name:'UnknownError'});}
    }
    const checked=z.array(z.object({id:z.string(),finish:z.literal('stop'),verdict:z.object({faithful:z.boolean(),issues:z.array(z.string())})})).parse(results);for(const sample of input.cases){const result=checked.find(value=>value.id===sample.id)!;assert.equal(result.verdict.faithful,sample.expected,sample.id);assert.equal(result.verdict.issues.length===0,sample.expected,sample.id);}
  }finally{writeFileSync(input.outputFile,JSON.stringify({at:new Date().toISOString(),realModel:true,qqSend:false,reasoningEffort:'off',temperature:0,packetHash:digest(JSON.stringify(input.packet)),results},null,2));await ctx.fiber.dispose();}
});
