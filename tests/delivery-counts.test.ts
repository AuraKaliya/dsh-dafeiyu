import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {conversationKey} from '@dafeiyu/contracts';
import type {PendingMessage} from '@dafeiyu/contracts';
import {Journal} from '@dafeiyu/journal';
import {ContextCoordinator} from '../packages/core/lib/context.js';
import {registerDeliveryCounts} from '../packages/core/lib/delivery-counts.js';
import {testTempDir} from './test-temp.js';

test('delivery counts keep the latest six replies, scope isolation and unknown sends distinct',async()=>{
  const root=mkdtempSync(join(testTempDir(),'delivery-counts-')),journal=new Journal(join(root,'journal.sqlite'));
  try{const conversation={channel:'qq',account:'1',kind:'private' as const,id:'2'},route=conversationKey('fish',conversation),contexts=new ContextCoordinator('fish',journal,{maxBytes:12000});registerDeliveryCounts(contexts,journal,'fish');
    const item:PendingMessage={id:randomUUID(),route,extensionId:'channel-qq',state:'processing',sessionId:'counts',reply:null,message:{id:'in',occurredAt:new Date().toISOString(),conversation,sender:{id:'2',displayName:'Owner'},text:'几条'}};
    const append=(id:string,other=false)=>journal.append({agentId:'fish',route:other?conversationKey('fish',{...conversation,id:'other'}):route,traceId:item.id,operationId:randomUUID(),causedBy:null,type:'delivery.counts',plugin:'core',pluginVersion:'1',occurredAt:new Date().toISOString(),sources:[],data:{deliveryId:id,total:3,confirmed:1,pending:1,sending:0,unknown:1,receiptIds:['42']}});
    for(let i=0;i<12;i++)append('reply-'+i);append('other-secret',true);append('reply-11');
    const region=(await contexts.prepare(item,new AbortController().signal)).find(row=>row.entry.contributor.id==='qq-delivery-counts')!;
    assert.equal(region.items.length,6);assert.doesNotMatch(JSON.stringify(region.items),/other-secret/);
    const latest=JSON.parse(region.items.at(-1)!.text);assert.equal(latest.confirmed,1);assert.equal(latest.unknown,1);assert.equal(latest.pending,1);assert.equal(latest.total,3);
  }finally{journal.close();}
});
