import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';
import {API_VERSION} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('local input failures return correction details, enter the ledger and stop identical read retries before dispatch',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'input-recovery-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');let channel:ExtensionHandle|undefined,step=0,dispatched=0;
  const errors:string[]=[];
  const adapter=new FixtureAdapter(request=>{
    const tool=request.messages.findLast(m=>m.role==='tool');if(tool){const output=JSON.parse(tool.content.filter(b=>b.type==='text').map(b=>b.text).join('')) as {status:string;errorCode?:string;data:{dispatched?:boolean;issues?:{field:string}[]}};
      if(output.errorCode){errors.push(output.errorCode);assert.equal(output.data.dispatched,false);if(output.errorCode==='INVALID_INPUT')assert.equal(output.data.issues?.[0]?.field,'limit');}}
    if(step<3)return toolResponse('fixture_read',{requestId:'bad-'+step++,limit:0});
    if(step++===3)return toolResponse('fixture_read',{requestId:'corrected',limit:1});return textResponse('已修正参数并完成读取。');
  });
  await writeFile(join(root,'persona.md'),'隔离测试。');const file=join(root,'host.json');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'input-recovery',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['fixture-channel'],actions:['fixture_read'],allowLocalWrite:false}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-channel',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{channel:'qq',account:'100001',deliver:async()=>({status:'sent',receiptId:'1'})}],actions:[{id:'fixture_read',version:'1',description:'读取一页',inputSchema:z.strictObject({requestId:z.string(),limit:z.number().int().min(1).max(20)}),outputSchema:z.json(),effects:'read',execute:async()=>{dispatched++;return {status:'succeeded',effects:'none',completeness:'complete',data:{read:true},sources:[],receipts:[]};}}]});
  }});
  try{
    channel!.ingest({id:randomUUID(),occurredAt:new Date().toISOString(),conversation:{channel:'qq',account:'100001',kind:'private',id:'200001'},sender:{id:'200001',displayName:'fixture'},text:'读取'});await host.core.whenIdle();
    assert.deepEqual(errors,['INVALID_INPUT','INVALID_INPUT','TOOL_NO_PROGRESS']);assert.equal(dispatched,1);assert.equal(host.core.journal.list(['delivered']).length,1);
    const db=new DatabaseSync(join(root,'data/core/runtime.sqlite'),{readOnly:true});try{const outcomes=db.prepare('SELECT outcome FROM run_operations ORDER BY ordinal').all().map(r=>JSON.parse(String(r.outcome)));assert.equal(outcomes.length,4);assert.equal(outcomes[3].status,'succeeded');}finally{db.close();}
  }finally{await host.close();}
});
