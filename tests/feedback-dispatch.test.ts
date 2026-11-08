import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Journal} from '@dafeiyu/journal';
import {FeedbackLedger} from '../packages/core/lib/feedback-ledger.js';
import {FeedbackDispatcher} from '../packages/core/lib/feedback-dispatch.js';
import type {FeedbackTarget} from '../packages/core/lib/feedback-dispatch.js';

test('feedback dispatcher sends due must-know while chat is active and defers worth-sharing until idle',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-dispatch-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-dispatch',()=>1000);
    const route='["agent-dispatch","qq","1","group","2"]';
    const mandatory=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'已经到期的反馈',dueAt:'1970-01-01T00:00:00.500Z'});
    const sharing=ledger.queue({workItemId:'task-1',route,kind:'worth-sharing',text:'可以晚点说的发现',expiresAt:'1970-01-01T00:05:00.000Z'});
    const sent:string[]=[];
    let active=1;
    const dispatcher=new FeedbackDispatcher({
      ledger,
      target:()=>({} as FeedbackTarget),
      deliver:async(record,_target,deliveryId)=>{sent.push(deliveryId);return {status:'sent',receiptId:'receipt:'+record.id};},
      sent:()=>{},
      pressure:()=>({interactiveActive:active,interactiveWaiting:0}),
    });
    assert.equal(await dispatcher.dispatch(1000),1);
    assert.deepEqual(sent,[`feedback:${mandatory.id}:1`]);
    assert.equal(ledger.pending(route).some(item=>item.id===sharing.id),true);

    active=0;
    assert.equal(await dispatcher.dispatch(1000),1);
    assert.equal(sent[1],`feedback:${sharing.id}:1`);
    assert.equal(ledger.pending(route).length,0);
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('an unknown delivery is parked for reconciliation and never auto-retried',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-unknown-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-dispatch',()=>1000);
    const route='["agent-dispatch","qq","1","group","2"]';
    const record=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'结果不明的反馈',dueAt:'1970-01-01T00:00:00.500Z'});
    let calls=0;
    const dispatcher=new FeedbackDispatcher({
      ledger,
      target:()=>({} as FeedbackTarget),
      deliver:async()=>{calls++;return {status:'unknown',code:'TRANSPORT_UNKNOWN'};},
      sent:()=>{},
      pressure:()=>({interactiveActive:0,interactiveWaiting:0}),
    });
    assert.equal(await dispatcher.dispatch(1000),0);
    assert.equal(calls,1);
    assert.equal(ledger.pending(route).length,0);
    assert.equal(ledger.unknownRecords()[0]?.id,record.id);
    assert.equal(await dispatcher.dispatch(1000),0);
    assert.equal(calls,1,'unknown must not be auto-retried');
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('a definite not-sent result returns to pending and stops after three attempts',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-retry-'));
  const journal=new Journal(join(root,'journal.sqlite'));
  try{
    const ledger=new FeedbackLedger(journal,'agent-dispatch',()=>1000);
    const route='["agent-dispatch","qq","1","group","2"]';
    const record=ledger.queue({workItemId:'task-1',route,kind:'must-know',text:'重试反馈',dueAt:'1970-01-01T00:00:00.500Z'});
    const dispatcher=new FeedbackDispatcher({
      ledger,
      target:()=>({} as FeedbackTarget),
      deliver:async()=>({status:'not-sent',code:'TRANSPORT_DOWN'}),
      sent:()=>{},
      pressure:()=>({interactiveActive:0,interactiveWaiting:0}),
    });
    await dispatcher.dispatch(1000);
    assert.equal(ledger.pending(route)[0]?.attempts,1);
    await dispatcher.dispatch(1000);
    assert.equal(ledger.pending(route)[0]?.attempts,2);
    await dispatcher.dispatch(1000);
    assert.equal(ledger.pending(route)[0]?.attempts,3);
    await dispatcher.dispatch(1000);
    assert.equal(ledger.pending(route)[0]?.attempts,3,'max attempts prevents an unbounded retry loop');
    assert.equal(ledger.pending(route)[0]?.id,record.id);
  }finally{
    journal.close();
    rmSync(root,{recursive:true,force:true});
  }
});

test('a thrown channel result becomes unknown rather than an alternate send',async()=>{
  const root=mkdtempSync(join(tmpdir(),'dafeiyu-feedback-throw-')),journal=new Journal(join(root,'journal.sqlite'));
  try{const ledger=new FeedbackLedger(journal,'fixture',()=>1000),record=ledger.queue({workItemId:'task',route:'route',kind:'must-know',text:'任务中断',dueAt:'1970-01-01T00:00:00.000Z'});let calls=0;
    const dispatcher=new FeedbackDispatcher({ledger,target:()=>({} as FeedbackTarget),deliver:async()=>{calls++;throw new Error('unconfirmed transport');},sent:()=>{},pressure:()=>({interactiveActive:0,interactiveWaiting:0})});
    await dispatcher.dispatch();await dispatcher.dispatch();assert.equal(calls,1);assert.equal(ledger.unknownRecords()[0]?.id,record.id);
  }finally{journal.close();rmSync(root,{recursive:true,force:true});}
});
