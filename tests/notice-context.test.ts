import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {conversationKey} from '@dafeiyu/contracts';
import type {PendingMessage} from '@dafeiyu/contracts';
import {Journal} from '@dafeiyu/journal';
import {ContextCoordinator} from '../packages/core/lib/context.js';
import {registerSentNotices} from '../packages/core/lib/notice-context.js';

test('sent notices from the current route become bounded context facts',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-notice-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const agentId='agent-notice';
    const conversation={channel:'qq',account:'10001',kind:'group' as const,id:'20002'};
    const route=conversationKey(agentId,conversation);
    const contexts=new ContextCoordinator(agentId,journal,{maxBytes:8000});
    registerSentNotices(contexts,journal,agentId);
    const item:PendingMessage={
      id:randomUUID(),
      route,
      extensionId:'channel-qq',
      state:'processing',
      sessionId:'session-notice',
      reply:null,
      message:{id:'message-1',occurredAt:new Date().toISOString(),conversation,sender:{id:'owner',displayName:'Owner'},text:'继续'},
    };
    for(const [text,deliveryId] of [['任务卡住了，已经完成两个页面。','task-status:one'],['最终结果已经整理好。','native-delivery:two']] as const){
      journal.append({agentId,route,traceId:item.id,operationId:randomUUID(),causedBy:null,type:'notice.sent',plugin:'@dafeiyu/core',pluginVersion:'1',
        occurredAt:new Date().toISOString(),sources:[{kind:'message',id:'message-1',route}],data:{text,deliveryId,status:'sent',kind:'progress'}});
    }

    const regions=await contexts.prepare(item,new AbortController().signal);
    const region=regions.find(entry=>entry.entry.contributor.id==='sent-notices');
    assert.ok(region);
    assert.equal(region.items.length,2);
    assert.match(region.items[0]!.text,/任务卡住了/);
    assert.match(region.items[1]!.text,/最终结果已经整理好/);
    assert.ok(region.items.every(entry=>entry.sources.length===1&&entry.sources[0]!.ref.startsWith('dafeiyu:journal:')));
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});
