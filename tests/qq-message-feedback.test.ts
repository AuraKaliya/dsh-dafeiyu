import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {API_VERSION,QQ_SEQUENCE_INSTRUCTIONS} from '@dafeiyu/contracts';
import type {ExtensionHandle} from '@dafeiyu/contracts';
import {QqStore} from '@dafeiyu/qq';
import {QqSegmentedTransport} from '../packages/channel-qq/lib/transport.js';
import {FixtureAdapter,textResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('real Core and QQ transport feed the confirmed message count into the next model turn',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'qq-counts-host-')),file=join(root,'host.json');
  process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const sent:string[]=[];const server=createServer(async(request,response)=>{
    assert.equal(request.url,'/send_private_msg');const chunks:Buffer[]=[];for await(const chunk of request)chunks.push(Buffer.from(chunk));
    const body=JSON.parse(Buffer.concat(chunks).toString());sent.push(body.message);response.setHeader('Content-Type','application/json');response.end(JSON.stringify({status:'ok',data:{message_id:String(sent.length)}}));
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));t.after(()=>{server.closeAllConnections();return new Promise<void>(done=>server.close(()=>done()));});
  const address=server.address();assert.ok(address&&typeof address!=='string');
  const ledger=new QqStore(join(root,'qq.sqlite'));t.after(()=>ledger.close());
  const transport=new QqSegmentedTransport({ledger:ledger.delivery,check:async()=>{},confirmed:()=>{},send:async(_reply,text)=>{
    const response=await fetch(`http://127.0.0.1:${address.port}/send_private_msg`,{method:'POST',body:JSON.stringify({message:text})});const result=await response.json() as {data:{message_id:string}};return result.data.message_id;
  }});
  let channel:ExtensionHandle|undefined;
  const adapter=new FixtureAdapter((request,call)=>{
    if(call===1){assert.match(JSON.stringify(request.messages),/qq_messages/);return textResponse(JSON.stringify({qq_messages:[{type:'text',text:'第一件事。再解释一句。'},{type:'text',text:'第二件事。'},{type:'text',text:'最后一句。'}]}));}
    const content=JSON.stringify(request.messages).replaceAll('\\','');assert.match(content,/qq-delivery-counts/);
    assert.match(content,/"confirmed":3/);assert.match(content,/"total":3/);
    return textResponse(JSON.stringify({qq_messages:[{type:'text',text:'刚才确认发出了三条消息。'}]}));
  });
  await writeFile(join(root,'persona.md'),'本机虚构验收人格。');
  await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'qq-counts',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({id:'fixture-channel',version:'1',protocolVersion:API_VERSION,agentId:'fish',channels:[{
      channel:'qq',account:'100001',description:QQ_SEQUENCE_INSTRUCTIONS,deliver:(reply,signal,guard)=>transport.deliver(reply,signal,guard),deliveryProgress:id=>{
        const p=ledger.delivery.progress(id);return p?{...p,sending:p.segments.filter(s=>s.state==='sending').length,receiptIds:p.segments.flatMap(s=>s.receipt?[s.receipt]:[]),canResume:false}:null;
      }}]});
  }});
  try{
    for(const [id,text] of [['1','分三条说明。'],['2','刚才发了几条？']]){
      channel!.ingest({id:id!,occurredAt:new Date().toISOString(),conversation:{channel:'qq',account:'100001',kind:'private',id:'200001'},sender:{id:'200001',displayName:'验收'},text:text!,mainText:text!});await host.ctx.dafeiyu.whenIdle();
    }
    assert.deepEqual(sent,['第一件事。再解释一句。','第二件事。','最后一句。','刚才确认发出了三条消息。']);assert.equal(adapter.requests.length,2);
  }finally{await host.close();}
});
