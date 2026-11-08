import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '@dafeiyu/journal';
import {FeedbackLedger} from '../packages/core/lib/feedback-ledger.js';

test('feedback ledger keeps must-know, worth-sharing and progress separate',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-feedback',()=>3_000);
    const route='["agent-feedback","qq","1","group","2"]';
    const mandatory=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'承诺的反馈到期了',dueAt:'1970-01-01T00:00:02.000Z'});
    const sharing=ledger.queue({workItemId:'task-1',route,kind:'worth-sharing',text:'看到一个有意思的评论',expiresAt:'1970-01-01T00:01:00.000Z'});
    ledger.queue({workItemId:'task-1',route,kind:'progress',text:'读到第三个页面'});

    assert.equal(ledger.pending(route).length,3);
    assert.deepEqual(ledger.due(route).map(item=>item.id),[mandatory.id]);
    assert.deepEqual(ledger.worthSharing(route).map(item=>item.id),[sharing.id]);

    const duplicate=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'承诺的反馈到期了',dueAt:'1970-01-01T00:00:02.000Z'});
    assert.equal(duplicate.id,mandatory.id,'same work item, kind and text is one pending promise');

    ledger.markSent(mandatory.id,'task-status:one',route);
    assert.equal(ledger.pending(route).length,2);
    assert.equal(ledger.due(route).length,0);

    ledger.expire(sharing.id,route);
    ledger.supersede(ledger.pending(route)[0]!.id,route);
    assert.equal(ledger.pending(route).length,0);
    assert.equal(ledger.pending('other-route').length,0);
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('claim is exclusive and unknown is parked for reconciliation instead of pending',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-claim-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-feedback',()=>3_000);
    const route='["agent-feedback","qq","1","group","2"]';
    const record=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'只能发一次的反馈',dueAt:'1970-01-01T00:00:02.500Z',sourceMessageId:'inbox-1',taskId:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000002',intentVersion:1});
    assert.equal(ledger.claim(record.id,route,'feedback:direct'),1);
    assert.equal(ledger.claim(record.id,route,'feedback:dispatcher'),null,'a second sender must not own the same record');
    ledger.settle(record.id,route,'feedback:direct','unknown',undefined,'TRANSPORT_UNKNOWN');
    assert.equal(ledger.pending(route).length,0);
    assert.equal(ledger.unknownRecords()[0]?.id,record.id);
    assert.equal(ledger.claim(record.id,route,'feedback:retry'),null,'unknown is not claimable again');
    ledger.settle(record.id,route,'feedback:direct','sent','receipt-1');
    assert.equal(ledger.unknownRecords().length,0);
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('legacy pending feedback can be attached to its original source',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-source-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-feedback',()=>3_000);
    const route='["agent-feedback","qq","1","group","2"]';
    const record=ledger.queue({workItemId:'run-1',route,kind:'must-know',text:'旧反馈',dueAt:'1970-01-01T00:00:02.500Z'});
    assert.equal(ledger.legacyPending()[0]?.id,record.id);
    ledger.attachSource(record.id,route,{sourceMessageId:'inbox-1',taskId:'00000000-0000-4000-8000-000000000001',runId:'00000000-0000-4000-8000-000000000003',intentVersion:1});
    assert.equal(ledger.legacyPending().length,0);
    assert.equal(ledger.pending(route)[0]?.sourceMessageId,'inbox-1');
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});
test('must-know feedback requires a due time',()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-feedback');
    assert.throws(()=>ledger.queue({workItemId:'task-1',route:'route',kind:'must-know',text:'x'}),/FEEDBACK_DUE_REQUIRED/);
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('program status is idempotent after sent or unknown and interrupted claims recover as unknown',()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-status-feedback-')),journal=new Journal(join(root,'journal.sqlite'));
  try{const ledger=new FeedbackLedger(journal,'fixture',()=>3000),input={workItemId:'task',route:'route',kind:'must-know' as const,text:'结果尚未交付',dueAt:'1970-01-01T00:00:01.000Z',statusVersion:'a'.repeat(64)};
    const first=ledger.queue(input);ledger.claim(first.id,'route','send-1');ledger.recoverSending();
    assert.equal(ledger.unknownRecords()[0]?.id,first.id);assert.equal(ledger.queue(input).id,first.id);assert.equal(ledger.claim(first.id,'route','send-2'),null);
    ledger.markSent(first.id,'send-1','route','receipt');assert.equal(ledger.queue(input).id,first.id);
    ledger.release(first.id,'route','LATE_FAILURE');assert.equal(ledger.pending('route').length,0);
    assert.notEqual(ledger.queue({...input,statusVersion:'b'.repeat(64)}).id,first.id);
  }finally{journal.close();rmSync(root,{recursive:true,force:true});}
});
