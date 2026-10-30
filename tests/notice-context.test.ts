import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {conversationKey} from '@dafeiyu/contracts';
import type {PendingMessage} from '@dafeiyu/contracts';
import {Journal} from '@dafeiyu/journal';
import {ContextCoordinator} from '../packages/core/lib/context.js';
import {buildNoticeViews,registerSentNotices} from '../packages/core/lib/notice-context.js';

test('notice attempts collapse into one latest view and only sent views carry a body',async()=>{
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
    const append=(deliveryId:string,status:'sent'|'not-sent'|'unknown',text:string,code?:string)=>{
      const textHash=createHash('sha256').update(text).digest('hex');
      journal.append({agentId,route,traceId:item.id,operationId:randomUUID(),causedBy:null,type:'notice.attempt',plugin:'@dafeiyu/core',pluginVersion:'1',
        occurredAt:new Date().toISOString(),sources:[{kind:'message',id:'message-1',route}],
        data:{text,textHash,deliveryId,status,kind:'progress',...(code?{code}:{})}});
    };
    append('task-status:retried','not-sent','这段未发送的草稿不该进入上下文','TRANSPORT_DOWN');
    append('task-status:retried','sent','这段已经补发成功');
    append('task-status:unsent','not-sent','这段始终没有发出去','TRANSPORT_DOWN');
    append('task-status:uncertain','unknown','这段结果不明的草稿不该进入上下文','DELIVERY_UNKNOWN');
    append('task-status:sent','sent','这段已经确认送达');

    const views=buildNoticeViews(journal.recentEvents(route,'notice.attempt',64));
    assert.equal(views.length,4);
    const retried=views.find(view=>view.deliveryId==='task-status:retried')!;
    assert.equal(retried.status,'sent');
    assert.equal(retried.text,'这段已经补发成功');
    const uncertain=views.find(view=>view.deliveryId==='task-status:uncertain')!;
    assert.equal(uncertain.status,'unknown');
    assert.equal(uncertain.text,undefined);
    assert.equal(uncertain.code,'DELIVERY_UNKNOWN');
    assert.ok(uncertain.textLength>0);
    const unsent=views.find(view=>view.deliveryId==='task-status:unsent')!;
    assert.equal(unsent.status,'not-sent');
    assert.equal(unsent.text,undefined);
    assert.equal(unsent.code,'TRANSPORT_DOWN');
    const sent=views.find(view=>view.deliveryId==='task-status:sent')!;
    assert.equal(sent.text,'这段已经确认送达');

    const regions=await contexts.prepare(item,new AbortController().signal);
    const region=regions.find(entry=>entry.entry.contributor.id==='sent-notices');
    assert.ok(region);
    assert.equal(region.items.length,4);
    const text=region.items.map(entry=>entry.text).join('\n');
    assert.match(text,/这段已经补发成功/);
    assert.match(text,/这段已经确认送达/);
    assert.doesNotMatch(text,/未发送的草稿/);
    assert.doesNotMatch(text,/始终没有发出去/);
    assert.doesNotMatch(text,/结果不明的草稿/);
    assert.match(text,/发送结果不明/);
    assert.match(text,/确定未发送/);
    assert.ok(region.items.every(entry=>entry.sources.length===1&&entry.sources[0]!.ref.startsWith('dafeiyu:journal:')));
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});
