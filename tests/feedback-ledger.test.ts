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
