import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { memoryFixture } from '../build-tests/memory-fixture.js';
import { config,fakeDependencies } from '../build-tests/retrieval-fixture.js';

const root=resolve('.runtime/demos',`context-${randomUUID()}`);await mkdir(root,{recursive:true});
const fake=fakeDependencies();const h=await memoryFixture(root,{context:{},retrieval:config},fake.dependency);
const okay=result=>{assert.equal(result.status,'ok');return result;};
const expiresAt=new Date(Date.now()+600000).toISOString();
const runtimeText=()=>JSON.stringify(h.adapter.requests.at(-1)?.messages.filter(m=>m.role==='user'&&m.source?.kind==='runtime-context'));
let native='原生测试区域：桌面材料就绪';
h.ctx.systemPrompt.context({name:'native-fixture',order:1,required:true,text:()=>native});
const second=h.core.registerExtension({id:'fictional-tasks',version:'1',protocolVersion:4,agentId:'dafeiyu',contexts:[{
  id:'progress',kind:'operational-fact',prepare:async request=>request.conversation.id==='test'?[{id:'task',version:'1',text:'虚构任务插件：等待材料确认',expiresAt,
    sources:[{ref:'fictional:task:731',version:'1',hash:'fixture'}]}]:[],validate:()=>true,
}]});
try{
  const source=await h.evidence('test','虚构中文资料：晨露项目采用青鱼888作为代号。');
  const saved=okay(await h.probe('test',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'晨露项目代号为青鱼888。',sourceRefs:[source.ref]})));
  const unused=okay(await h.probe('test',c=>h.memory.create(c,{requestId:randomUUID(),kind:'knowledge',claimType:'self_report',content:'未选中的虚构糕点资料',sourceRefs:[source.ref]})));
  const retrieved=okay(await h.probe('test',c=>h.memory.retrieveContext(c,{requestId:randomUUID(),expectedVersion:0,taskId:'fictional-731',expiresAt,query:'晨露青鱼888',strategy:'hybrid',limit:1})));
  assert.match(runtimeText(),/青鱼888/);assert.ok(!runtimeText().includes('未选中的虚构糕点资料'));
  okay(await h.probe('test',c=>h.memory.updateWorking(c,{requestId:randomUUID(),expectedVersion:0,taskId:'fictional-731',expiresAt,
    items:[{id:'goal',category:'goal',text:'核对晨露项目代号',sourceRefs:[`dafeiyu:memory:${saved.id}:1`]}]})));
  assert.match(runtimeText(),/核对晨露项目代号/);assert.match(runtimeText(),/虚构任务插件/);assert.match(runtimeText(),/原生测试区域/);
  const before=h.core.journal.events(source.message.route).findLast(e=>e.type==='context.admitted');
  native='原生测试区域：桌面材料更新完成';
  await h.seed('test','检查区域共存');assert.match(runtimeText(),/桌面材料更新完成/);assert.match(runtimeText(),/青鱼888/);
  const deleted=okay(await h.probe('test',c=>h.memory.delete(c,{requestId:randomUUID(),id:saved.id,expectedVersion:1,reason:'虚构用户明确删除'})));
  assert.ok(!runtimeText().includes('青鱼888'));assert.ok(!runtimeText().includes('核对晨露项目代号'));
  assert.match(runtimeText(),/虚构任务插件/);assert.match(runtimeText(),/桌面材料更新完成/);
  const after=h.core.journal.events(source.message.route).findLast(e=>e.type==='context.admitted');
  await h.seed('other','另一个会话');assert.ok(!runtimeText().includes('青鱼888'));assert.ok(!runtimeText().includes('虚构任务插件'));
  const result={at:new Date().toISOString(),projectVersion:'0.7.0',dsh:'0.2.1-rc.2',model:'scripted',embedding:'simulated-contract',data:'fictional-Chinese',
    serverAccess:false,selected:retrieved.selected,unselectedExcluded:true,analysisReportInjected:false,
    before:{regions:before.data.selected.map(r=>`${r.owner}:${r.region}`),bytes:before.data.bytes,requestBytes:before.data.requestBytes},
    after:{regions:after.data.selected.map(r=>`${r.owner}:${r.region}`),bytes:after.data.bytes,retired:after.data.retired},
    nativeRegionPreserved:true,nativeUpdateSucceeded:true,otherConversationIsolated:true,logicalDeleteVersion:deleted.version,
    originalMemoryCount:unused.id?2:1};
  await writeFile(resolve('docs/memory-phase-4-results.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{second.dispose();await h.close();}
