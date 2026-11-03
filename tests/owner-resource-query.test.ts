import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {z} from 'zod';
import {API_VERSION,ConversationSchema} from '@dafeiyu/contracts';
import type {Conversation,ExtensionHandle,PersonaSourceRef} from '@dafeiyu/contracts';
import {FixtureAdapter,textResponse,toolResponse} from './sdk-fixture.js';
import {testTempDir} from './test-temp.js';

test('trusted owner-private queries span current groups while group, stranger and revoked access stay isolated',{timeout:30000},async t=>{
  const root=await mkdtemp(join(testTempDir(),'owner-resources-'));process.env.DSH_HOME=join(root,'data/core/dsh-home');
  const {ManagedHost,loadHostConfig,initializeProfile}=await import('@dafeiyu/host');
  const owner:Conversation={channel:'qq',account:'100001',kind:'private',id:'200001'},a:Conversation={...owner,kind:'group',id:'300001'},b:Conversation={...a,id:'300002'};
  let groups=[a,b],channel:ExtensionHandle|undefined,step=0,requested:Conversation|undefined,observing=false,observedValid=false,answerSawObservation=false;
  const results:unknown[]=[],observations:{source:PersonaSourceRef;route:string}[]=[];
  const adapter=new FixtureAdapter(request=>{if(++step===1)return toolResponse(observing?'qq_browse':'fixture_resources',observing?{}:requested?{target:requested}:{});if(observing){assert.match(JSON.stringify(request.messages),/GROUP_A_VALUE/);answerSawObservation=true;}return textResponse('查询已结束。');});
  await writeFile(join(root,'persona.md'),'隔离测试人格。');
  const file=join(root,'host.json');await writeFile(file,JSON.stringify({schemaVersion:1,profileId:'owner-resources',agent:{id:'fish'},paths:{core:'./data/core',memory:'./data/memory',sessions:'./data/sessions',query:'./data/query.sqlite'},modelRoutes:{chat:{provider:'local-test',model:'scripted'}},persona:{fixedFile:'./persona.md',kind:'test'},plugins:[{id:'model-scripted',required:true},{id:'timeline',required:true,config:{execution:true}},{id:'memory-growth',required:true}],authorityPolicies:[{id:'conversation',producers:['channel-qq'],actions:['fixture_resources','qq_browse']}]}));
  const config=loadHostConfig(file),coordination=join(root,'coordination.sqlite');initializeProfile(config,coordination);
  const host=await ManagedHost.start(config,{coordination,adapter,signal:t.signal,installChannels:ctx=>{
    channel=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'channel-qq',version:'fixture',agentId:'fish',channels:[{channel:'qq',account:'100001',deliver:async reply=>({status:'sent',receiptId:reply.id})}]});
    ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'fixture-reader',version:'fixture',agentId:'fish',
      resourceProofs:{current:proof=>groups.some(scene=>JSON.stringify(scene)===JSON.stringify(proof.scene)),epoch:()=>JSON.stringify(groups)},
      ownerDirectory:{channelExtensionId:'channel-qq',channel:'qq',account:'100001',ownerId:'200001',snapshot:()=>({revision:JSON.stringify(groups),resources:[owner,...groups]})},
      actions:[{id:'fixture_resources',version:'1',description:'Query current permitted resources',inputSchema:z.strictObject({target:ConversationSchema.optional()}),outputSchema:z.json(),effects:'read',execute:async(raw,context)=>{
        const input=z.object({target:ConversationSchema.optional()}).parse(raw);
        try{const data=input.target?ctx.dafeiyu.authorizeCapabilityResource(context,'fixture-reader',input.target):ctx.dafeiyu.capabilityResources(context,'fixture-reader');results.push(data);
          return {status:'succeeded',effects:'none',completeness:'complete',sources:[],receipts:[],data:z.json().parse(data)};
        }catch(error){const code=error instanceof Error?error.message:'FAILED';results.push(code);return {status:'failed',effects:'none',completeness:'unknown',sources:[],receipts:[],data:null,errorCode:code};}
      }},{id:'qq_browse',version:'1',description:'Observe actual authorized group material',inputSchema:z.strictObject({}),outputSchema:z.json(),effects:'read',execute:async(_raw,context)=>{
        const scene=ctx.dafeiyu.authorizeCapabilityResource(context,'fixture-reader',a),page={messages:[{id:'message-a',text:'GROUP_A_VALUE'}]};
        const observation=ctx.dafeiyu.recordCapabilityObservation(context,'fixture-reader',{requestId:'group-observation',proof:{provider:'fixture-reader',scene,key:'group-a',version:1,hash:'a'.repeat(64),roots:['group-a-message'],detail:{}},text:JSON.stringify(page),occurredAt:new Date().toISOString(),coverage:['actual fixture group message'],counts:{received:1,processed:1}});
        observations.push({source:observation.source,route:context.scope.kind==='conversation'?context.scope.route:context.scope.scopeKey});
        observedValid=ctx.dafeiyu.capabilityObservationCurrent({agentId:'fish',route:context.scope.kind==='conversation'?context.scope.route:context.scope.scopeKey},observation.source);
        return {status:'succeeded',effects:'none',completeness:'complete',sources:[{id:observation.source.id,scopeKey:observation.source.scopeKey,version:observation.source.version,contentHash:observation.source.contentHash}],receipts:[],data:z.json().parse({page,observation})};
      }}]});
  }});
  const query=async(scene:Conversation,sender:string,target?:Conversation)=>{step=0;requested=target;channel!.ingest({id:String(results.length+1),occurredAt:new Date().toISOString(),conversation:scene,sender:{id:sender,displayName:'fixture'},text:'查询当前范围。',mainText:'查询当前范围。'});await host.ctx.dafeiyu.whenIdle();return results.at(-1);};
  try{
    assert.deepEqual(await query(owner,'200001'),[owner,a,b]);
    assert.deepEqual(await query(a,'200001'),[a],'owner speaking in a group does not acquire private-owner query authority');
    const stranger={...owner,id:'200002'};assert.deepEqual(await query(stranger,'200002'),[stranger]);
    assert.deepEqual(await query(owner,'200001',b),b);
    assert.equal(await query(a,'200001',b),'RESOURCE_SCOPE_DENIED');
    groups=[a];assert.equal(await query(owner,'200001',b),'RESOURCE_SCOPE_DENIED');
    assert.deepEqual(await query(owner,'200001'),[owner,a]);
    observing=true;step=0;channel!.ingest({id:'observe-a',occurredAt:new Date().toISOString(),conversation:owner,sender:{id:owner.id,displayName:'owner'},text:'查看群A的实际材料',mainText:'查看群A的实际材料'});await host.ctx.dafeiyu.whenIdle();assert.equal(observedValid,true);assert.equal(answerSawObservation,true);groups=[];assert.equal(host.ctx.dafeiyu.capabilityObservationCurrent({agentId:'fish',route:observations[0]!.route},observations[0]!.source),false,'revoked membership invalidates the retained cross-group observation');
  }finally{await host.close();}
});
