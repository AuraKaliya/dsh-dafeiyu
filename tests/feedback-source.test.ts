import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '@dafeiyu/journal';
import {MessageSchema,conversationKey} from '@dafeiyu/contracts';
import {feedbackSourceCurrent} from '../packages/core/lib/feedback-source.js';
import type {FeedbackRecord} from '../packages/core/lib/feedback-ledger.js';

const record=(overrides:Partial<FeedbackRecord>={}):FeedbackRecord=>({
  id:'00000000-0000-4000-8000-000000000010',workItemId:'run-1',route:'route-1',kind:'must-know',text:'反馈',
  state:'pending',createdAt:'1970-01-01T00:00:00.000Z',attempts:0,sourceMessageId:'inbox-1',
  taskId:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000002',intentVersion:2,dueAt:'1970-01-01T00:00:01.000Z',...overrides,
});
const ports=(options:{recalled?:boolean;epoch?:number;route?:string;missing?:boolean;status?:string}={})=>({
  journal:{
    get:(_id:string)=>{if(options.missing)throw new Error('MISSING');return {route:options.route??'route-1',message:{id:'external-1'}};},
    messageRecalled:()=>options.recalled??false,
  },
  repository:{readState:()=>({epoch:options.epoch??2,status:options.status??'active'})},
  agentId:'agent-1',
}) as never;

test('feedback source requires the original inbound, no recall and the same task epoch',()=>{
  assert.equal(feedbackSourceCurrent(record(),ports()),true);
  assert.equal(feedbackSourceCurrent(record(),ports({recalled:true})),false,'a recalled original cannot authorize a late send');
  assert.equal(feedbackSourceCurrent(record(),ports({epoch:3})),false,'a changed task epoch invalidates the old feedback');
  assert.equal(feedbackSourceCurrent(record(),ports({status:'paused'})),false,'a paused task cannot authorize a late status notice');
  assert.equal(feedbackSourceCurrent(record(),ports({route:'other-route'})),false);
  assert.equal(feedbackSourceCurrent(record(),ports({missing:true})),false);
  assert.equal(feedbackSourceCurrent(record({sourceMessageId:''}),ports()),false);
});

test('a real journal row is invalidated by a message.recalled event',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-source-journal-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const conversation={channel:'simulator',account:'bot',kind:'private' as const,id:'owner'};
    const message=MessageSchema.parse({id:'message-1',occurredAt:'1970-01-01T00:00:00.000Z',conversation,sender:{id:'owner',displayName:'主人'},text:'原始消息'});
    const receipt=journal.accept('agent-1','simulator','1',message),route=conversationKey('agent-1',conversation);
    const current=record({sourceMessageId:receipt.id,route});
    const actual={journal,repository:{readState:()=>({epoch:2,status:'active'})},agentId:'agent-1'};
    assert.equal(feedbackSourceCurrent(current,actual as never),true);
    journal.append({agentId:'agent-1',route,traceId:receipt.id,operationId:receipt.id,causedBy:null,type:'message.recalled',plugin:'simulator',pluginVersion:'1',
      occurredAt:'1970-01-01T00:00:01.000Z',sources:[],data:{messageId:message.id}});
    assert.equal(feedbackSourceCurrent(current,actual as never),false,'a recalled journal row cannot authorize a delayed send');
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});
