import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {Context} from '@deepseek-ai/cordis';
import type {Extension,ExecutionContext,DshToolsPort} from '@dafeiyu/contracts';
import {bindDshTools} from '../packages/host/lib/dsh-tools.js';
import {testTempDir} from './test-temp.js';

test('DSH discovery gives an authenticated owner a concrete task handoff and locators, not an inspection claim',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-handoff-'));let extension:Extension|undefined,owner=true;
  const ctx={dafeiyu:{executionAuthority:()=>{},isOwnerExecution:()=>owner,bindHarnessCatalog:()=>()=>{},registerExtension:(value:Extension)=>{extension=value;return {dispose(){}};}}} as unknown as Context;
  const port:DshToolsPort={catalog:async()=>({version:'a'.repeat(64),tools:[{name:'read',description:'Read a local file',parameters:{type:'object',properties:{path:{type:'string'}}}}],environment:{workingDirectory:root,developmentDirectory:root,platform:'win32',inspection:{kind:'local-instance-locators',dataDirectory:root,statusFile:join(root,'host-status.json'),filesRead:false,sourceFiles:[{purpose:'loaded QQ implementation',path:join(root,'capabilities.js')}]}}}),execute:async()=>assert.fail('listing must not execute'),read:async()=>assert.fail('listing must not read')};
  const handle=bindDshTools(ctx,'fish',port,join(root,'receipts'));
  try{const action=extension!.actions!.find(action=>action.id==='dsh_tool_list')!,conversation={channel:'qq',account:'100001',kind:'private' as const,id:'200001'};
    const context={agentId:'fish',taskId:null,runId:randomUUID(),operationId:randomUUID(),intentVersion:0,origin:{kind:'message',inboundId:randomUUID(),conversation},scope:{kind:'conversation',agentId:'fish',route:'fixture'},signal:new AbortController().signal} as ExecutionContext;
    const result=await action.execute({query:'QQ专用工具'},context),data=z.object({matched:z.number(),environment:z.object({inspection:z.object({filesRead:z.literal(false)})}),handoff:z.object({entry:z.literal('qq_task_submit'),requiredForActualInspection:z.literal(true),ownerAuthorized:z.literal(true)})}).parse(result.data);
    assert.equal(data.matched,0);assert.equal(result.sources.length,0);assert.equal(result.receipts.length,0);
    owner=false;const denied=await action.execute({},context);assert.equal(denied.status,'succeeded');assert.equal(z.record(z.string(),z.json()).parse(denied.data).environment,undefined);
  }finally{handle.dispose();}
});
