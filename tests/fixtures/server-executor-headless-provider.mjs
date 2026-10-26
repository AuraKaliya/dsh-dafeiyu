// Only mounted by the explicit offline manifest. This is a provider, not a replacement CLI/Agent loop.
import { readFile,writeFile,appendFile } from 'node:fs/promises';
import { dirname,join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const name='dafeiyu-headless-scripted-provider';
export const inject=['llm'];
export async function apply(ctx,{manifestPath}){
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));if(manifest.mode!=='offline')throw new Error('FIXTURE_OFFLINE_ONLY');
  const packages=dirname(dirname(manifest.installAnchor)),sdk=await import(pathToFileURL(join(packages,'dsh-llm','lib','index.js')).href),scenario=JSON.parse(await readFile(join(process.cwd(),'fixture-scenario.json'),'utf8'));
  let calls=0;
  class Scripted extends sdk.LlmAdapter {
    async resolveModel(provider,id){return {provider,id,name:id,context:{contextWindow:manifest.route.contextWindow},defaultMaxTokens:manifest.route.maxOutputTokens,systemPromptUpdate:'in-history',toolUpdate:'in-history'};}
    async *stream(options){
      const permits=(await readFile(join(process.cwd(),'permits.ndjson'),'utf8')).trim().split('\n').filter(Boolean);if(permits.length<=calls)throw new Error('FIXTURE_DISPATCH_WITHOUT_PARENT_PERMIT');calls++;
      const names=(options.tools??[]).map(tool=>tool.name);await appendFile(join(process.cwd(),'provider-observed.ndjson'),JSON.stringify({call:calls,purpose:options.purpose??'task',tools:names,unexpectedEnv:Object.hasOwn(process.env,'EXECUTOR_UNEXPECTED_ENV')})+'\n');
      yield {type:'block-start',index:0,blockType:'reasoning'};yield {type:'reasoning-delta',index:0,text:'SYNTHETIC_HEADLESS_PRIVATE_REASONING_SENTINEL'};
      yield {type:'block-end',index:0,block:{type:'reasoning',text:'SYNTHETIC_HEADLESS_PRIVATE_REASONING_SENTINEL'}};
      const taskStep=calls;
      if(options.purpose){yield {type:'block-start',index:1,blockType:'text'};yield {type:'text-delta',index:1,text:'Synthetic auxiliary response'};yield {type:'block-end',index:1,block:{type:'text',text:'Synthetic auxiliary response'}};}
      else if(taskStep<=3){
        const instruction=taskStep===1?{name:'write',arguments:{file_path:'headless-proof.txt',content:'official headless file tool proof\n'}}:
          taskStep===2?{name:'read',arguments:{file_path:'headless-proof.txt'}}:
          {name:'pwsh',arguments:{description:'Write a fictional local command proof',command:"[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'headless-command-proof.txt'), 'official pwsh proof')",timeoutMs:5000}};
        const id=sdk.ToolCallId('headless-fixture-'+taskStep);yield {type:'block-start',index:1,blockType:'tool-call'};
        yield {type:'tool-call-delta',index:1,id,name:instruction.name,argumentsDelta:JSON.stringify(instruction.arguments)};
        yield {type:'block-end',index:1,block:{type:'tool-call',id,name:instruction.name,arguments:JSON.stringify(instruction.arguments)}};
      }else {yield {type:'block-start',index:1,blockType:'text'};yield {type:'text-delta',index:1,text:'真实官方 headless 已运行脚本提供方和本机文件工具；这不是付费模型或服务器管理员验收。'};
        yield {type:'block-end',index:1,block:{type:'text',text:'真实官方 headless 已运行脚本提供方和本机文件工具；这不是付费模型或服务器管理员验收。'}};}
      if(scenario.mode!=='missing')yield {type:'usage',usage:{inputTokens:3,cacheReadTokens:4,cacheWriteTokens:5,outputTokens:6,reasoningTokens:2,totalTokens:18}};
      yield {type:'finish',reason:{kind:!options.purpose&&taskStep<=3?'tool-calls':'stop'}};
    }
  }
  ctx.llm.registerAdapter([manifest.route.provider],new Scripted());
  // This public marker contains no message content and proves the adapter module came from the real profile loader.
  await writeFile(join(process.cwd(),'provider-mounted.json'),JSON.stringify({sdk:'0.2.1-rc.2',profile:manifest.profileName}));
}
