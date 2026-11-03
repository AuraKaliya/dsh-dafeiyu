import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {API_VERSION,QQ_SEQUENCE_INSTRUCTIONS} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('a new conversation turn can execute while an interrupted reply is still awaiting a decision',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'qq-interrupted-turn-')),file=join(root,'host.json');
  process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const ledger=new QqStore(join(root,'qq.sqlite')),sent:string[]=[];let firstReply:string|undefined,originalInbound:string|undefined;
  const transport=new QqSegmentedTransport({ledger:ledger.delivery,confirmed:()=>{},check:async reply=>{
    firstReply??=reply.id;
    if(reply.id===firstReply&&ledger.delivery.progress(reply.id)?.confirmed===1)throw new Error('DELIVERY_INTERRUPTED_BY_MESSAGE');
  },send:async(_reply,text)=>{sent.push(text);return String(sent.length);}});
  let channel:ExtensionHandle|undefined,normalTurns=0;
  const adapter=new FixtureAdapter(request=>{
    if(String(request.sessionId).startsWith('dafeiyu-reply-decision-'))return textResponse(JSON.stringify({decisions:[{inboundId:originalInbound,action:'wait'}]}));
    if(String(request.sessionId).startsWith('dafeiyu-recovery-'))return textResponse(JSON.stringify({next:'wait',message:'处理失败。'}));
    normalTurns++;
    return textResponse(JSON.stringify({qq_messages:normalTurns===1?[{type:'text',text:'第一条已有回执。'},{type:'text',text:'第二条尚未发送。'}]:[{type:'text',text:'新消息已进入执行。'}]}));
  });
  await writeFile(join(root,'persona.md'),'本机隔离验收。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'qq-interrupted-turn',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-channel',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{
      channel:'qq',account:'100001',description:QQ_SEQUENCE_INSTRUCTIONS,deliver:(reply,signal,guard)=>transport.deliver(reply,signal,guard),deliveryProgress:id=>{
        const p=ledger.delivery.progress(id);return p?{...p,sending:p.segments.filter(s=>s.state==='sending').length,receiptIds:p.segments.flatMap(s=>s.receipt?[s.receipt]:[]),canResume:p.pending>0&&p.unknown===0}:null;
      }}]});
  }});
  try{
    const ingest=(id:string,text:string)=>channel!.ingest({id,occurredAt:new Date().toISOString(),conversation:{channel:'qq',account:'100001',kind:'private',id:'200001'},sender:{id:'200001',displayName:'验收'},text,mainText:text});
    ingest('first','分两条说明。');await host.ctx.dafeiyu.whenIdle();
    originalInbound=host.ctx.dafeiyu.journal.list(['uncertain'])[0]?.id;assert.ok(originalInbound);
    ingest('next','先查查刚才的消息记录。');await host.ctx.dafeiyu.whenIdle();
    assert.equal(normalTurns,2,'pending reply tools must not prevent the next model request');
    assert.deepEqual(sent,['第一条已有回执。','新消息已进入执行。']);
    assert.equal(ledger.delivery.progress(firstReply!)?.confirmed,1);
    assert.equal(host.ctx.dafeiyu.journal.list(['delivered']).length,1);
  }finally{await host.close();ledger.close();}
});

