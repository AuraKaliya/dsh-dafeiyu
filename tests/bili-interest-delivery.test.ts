import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { BiliService,BILI_ACTIONS,BILI_SCENE } from '@dafeiyu/bilibili';
import { qqCapabilityFixture,outcomes } from './qq-capabilities-fixture.js';
import { call,textReply } from './harness.js';

test('QQ conversation interest can choose Bili discovery and return only public material through target-persona delivery',async()=>{let bili:BiliService|undefined,platformReads=0;const h=await qqCapabilityFixture({tasks:true,deliverResults:true,extraTaskActions:[...BILI_ACTIONS],extraTaskResources:[BILI_SCENE],explorationResources:[BILI_SCENE],beforeActivate:async(ctx,root)=>{
  bili=new BiliService(ctx,{agentId:'dafeiyu',profileId:'qq-capability-fixture',dataDir:join(root,'core'),createStore:true,settings:{minIntervalMs:100}},async()=>{platformReads++;const bytes=Buffer.from(JSON.stringify({code:0,data:{list:[{bvid:'BV1xx411c7mD',aid:10,title:'公开虚构星空样本',owner:{name:'虚构UP'},duration:60}],no_more:true}}));return {status:200,headers:{},body:(async function*(){yield bytes;})(),close(){}};});bili.recover();bili.activate();}});
  try{let chat=0,work=0;h.setResponse(request=>{const session=String(request.sessionId);if(session.startsWith('memory-expression-verify-delivery-'))return textReply('{"faithful":true,"issues":[]}');if(session.startsWith('dafeiyu-delivery-v3-')){assert.ok(JSON.stringify(request.messages).includes('公开虚构星空样本'));assert.ok(!JSON.stringify(request.messages).includes('PRIVATE_INTERNAL_RESULT'));return textReply('我发现了一个标题为“公开虚构星空样本”的视频，还没有观看音画。');}
    if(session.startsWith('dafeiyu-task-'))return ++work===1?call('bili_discover',{requestId:'explore'}):textReply('PRIVATE_INTERNAL_RESULT：不能直接转发');
    assert.match(JSON.stringify(request.messages),/task-capability-catalog/);assert.match(JSON.stringify(request.messages),/bili_discover/);assert.ok(!request.tools?.some(tool=>tool.name==='bili_discover'));
    return ++chat===1?call('qq_explore',{requestId:'interest',goal:'我想找些星空视频看看'}):textReply('这个话题让我想去看看');});
    await h.message('今天看到很多星星',{trigger:true,sender:'99887766'});assert.equal(platformReads,1);const db=new DatabaseSync(join(h.root,'core/runtime.sqlite'),{readOnly:true});try{const row=db.prepare("SELECT q.body FROM execution_requests q WHERE q.producer='qq-tasks'").get()!,body=z.object({motivation:z.object({kind:z.string()})}).parse(JSON.parse(String(row.body)));assert.equal(body.motivation.kind,'self-exploration');}finally{db.close();}
    assert.ok(JSON.stringify(h.platform.sent).includes('公开虚构星空样本'));assert.ok(!JSON.stringify(h.platform.sent).includes('PRIVATE_INTERNAL_RESULT'));
  }finally{await bili!.close();await h.close();}
});
