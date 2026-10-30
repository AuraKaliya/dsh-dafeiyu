import test from 'node:test';
import assert from 'node:assert/strict';
import {feedbackSourceCurrent} from '../packages/core/lib/feedback-source.js';
import type {FeedbackRecord} from '../packages/core/lib/feedback-ledger.js';

const record=(overrides:Partial<FeedbackRecord>={}):FeedbackRecord=>({
  id:'00000000-0000-4000-8000-000000000010',workItemId:'run-1',route:'route-1',kind:'must-know',text:'反馈',
  state:'pending',createdAt:'1970-01-01T00:00:00.000Z',attempts:0,sourceMessageId:'inbox-1',
  taskId:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000002',intentVersion:2,dueAt:'1970-01-01T00:00:01.000Z',...overrides,
});
const ports=(options:{recalled?:boolean;epoch?:number;route?:string;missing?:boolean}={})=>({
  journal:{
    get:(_id:string)=>{if(options.missing)throw new Error('MISSING');return {route:options.route??'route-1'};},
    messageRecalled:()=>options.recalled??false,
  },
  repository:{readState:()=>({epoch:options.epoch??2})},
  agentId:'agent-1',
}) as never;

test('feedback source requires the original inbound, no recall and the same task epoch',()=>{
  assert.equal(feedbackSourceCurrent(record(),ports()),true);
  assert.equal(feedbackSourceCurrent(record(),ports({recalled:true})),false,'a recalled original cannot authorize a late send');
  assert.equal(feedbackSourceCurrent(record(),ports({epoch:3})),false,'a changed task epoch invalidates the old feedback');
  assert.equal(feedbackSourceCurrent(record(),ports({route:'other-route'})),false);
  assert.equal(feedbackSourceCurrent(record(),ports({missing:true})),false);
  assert.equal(feedbackSourceCurrent(record({sourceMessageId:''}),ports()),false);
});
