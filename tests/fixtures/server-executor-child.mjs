// Fixed offline fixture: actual Node + Cordis/DSH dispatch, scripted adapter only, no credential/provider plugins.
import { readFile,appendFile,writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join,resolve } from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import LlmRuntime,{LlmAdapter,createUserMessage} from '@deepseek-ai/dsh-llm';
import { SessionId } from '@deepseek-ai/dsh-session';
import { ExecutorChildBudgetClient,installExecutorChildBilling } from '../../packages/server-executor/lib/child.js';
import { childIpcEndpoint } from '../../packages/server-executor/lib/ipc.js';

const file=process.argv[2];if(!file||resolve(file)!==join(process.cwd(),'profile.json'))throw new Error('FIXTURE_PROFILE_REQUIRED');
const bytes=await readFile(file),profile=JSON.parse(bytes.toString('utf8'));
if(profile.fixture!==true||!['normal','missing','error','crash','hang','stubborn','wrong-profile'].includes(profile.scenario)||!Number.isInteger(profile.calls)||profile.calls<1||profile.calls>45)throw new Error('FIXTURE_CONFIG_INVALID');
const hash=createHash('sha256').update(bytes).digest('hex'),client=new ExecutorChildBudgetClient(childIpcEndpoint(),profile.scenario==='wrong-profile'?'f'.repeat(64):hash),ctx=new Context(),abort=new AbortController();
const emit=value=>process.stdout.write(JSON.stringify(value)+'\n');let dispatched=0,dispose=()=>{};
class Backend extends LlmAdapter {
  async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:1024},defaultMaxTokens:100};}
  async *stream(options){
    const permits=(await readFile(join(process.cwd(),'permits.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    if(permits.length<=dispatched)throw new Error('FIXTURE_DISPATCH_BEFORE_RESERVATION');dispatched++;
    await appendFile(join(process.cwd(),'dispatch.ndjson'),JSON.stringify({ordinal:dispatched,purpose:options.purpose??'task',permit:permits[dispatched-1].reservationId})+'\n');
    if(profile.scenario==='crash')process.exit(19);
    if(profile.scenario==='stubborn'){setInterval(()=>{},1000);await new Promise(()=>{});}
    if(profile.scenario==='hang')await new Promise((_,reject)=>{const timer=setInterval(()=>{},1000);abort.signal.addEventListener('abort',()=>{clearInterval(timer);reject(new Error('FIXTURE_ABORTED'));},{once:true});});
    if(profile.scenario!=='missing')yield {type:'usage',usage:{inputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2,totalTokens:18}};
    yield {type:'finish',reason:profile.scenario==='error'?{kind:'error',failure:{code:'FIXTURE_ERROR',message:'SYNTHETIC_ERROR_NOT_TELEMETRY'}}:{kind:'stop'}};
  }
}
try{
  await ctx.plugin(LlmRuntime);ctx.llm.registerAdapter(['executor-scripted'],new Backend());dispose=installExecutorChildBilling(ctx,client,()=>abort.abort());
  await client.ready();let input='';for await(const chunk of process.stdin)input+=chunk.toString();const task=JSON.parse(input);if(task.goal!=='fictional local proof')throw new Error('FIXTURE_INPUT_INVALID');
  emit({type:'session',sessionId:'synthetic-node-session'});emit({type:'thinking',text:'SYNTHETIC_PRIVATE_THOUGHT_NEVER_ARCHIVE'});process.stderr.write('SYNTHETIC_PRIVATE_STDERR_NEVER_ARCHIVE');
  await writeFile(join(process.cwd(),'env-proof.json'),JSON.stringify({unexpectedPresent:Object.hasOwn(process.env,'EXECUTOR_UNEXPECTED_SECRET'),nodeOptionsPresent:Object.hasOwn(process.env,'NODE_OPTIONS')}));
  for(let i=0;i<profile.calls;i++){
    const purpose=i%3===0?'task':i%3===1?'compaction':'session-title';
    for await(const _ of ctx.llm.stream({provider:'executor-scripted',model:'fixture',maxTokens:100,sessionId:SessionId('synthetic-'+purpose),signal:abort.signal,...(purpose==='task'?{}:{purpose}),
      messages:[createUserMessage({source:{kind:'user'},content:[{type:'text',text:'SYNTHETIC_PRIVATE_REQUEST_NEVER_ARCHIVE'}]})]})){}
  }
  await writeFile(join(process.cwd(),'fixture-proof.txt'),'fictional local write completed\n');
  emit({type:'tool_call',callId:'fixture-local-write',tool:'fixture_write',input:{secret:'SYNTHETIC_TOOL_ARGUMENT'}});
  emit({type:'tool_result',callId:'fixture-local-write',status:'completed',result:'SYNTHETIC_TOOL_RAW_RESULT'});
  emit({type:'final',text:'脚本夹具完成本机文件写入；这不是付费模型或服务器权限证明。'});await client.finish();
}catch{process.exitCode=2;}
finally{dispose();client.close();await ctx.fiber.dispose();}
