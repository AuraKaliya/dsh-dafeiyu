import assert from 'node:assert/strict';
import { mkdir,writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { memoryFixture } from '../build-tests/memory-fixture.js';
import { fixtureTool,report,invoke,archivePointer,nextTurn } from '../build-tests/feedback-fixture.js';

const root=resolve('.runtime/demos',`feedback-${randomUUID()}`);await mkdir(root,{recursive:true});
const h=await memoryFixture(root,{feedback:{maxBriefBytes:4096,maxPageChars:1000},context:{}});
const data=Array.from({length:200},(_,i)=>`第${i+1}条虚构日志：中文🙂状态信息，仅用于本机测试。`).join('\n')+'\nFICTIONAL_TAIL_842';
const tool=fixtureTool(h,()=>report(data,{outcome:'partial',effects:'none',completeness:'partial',diagnostics:[{code:'UPSTREAM_PARTIAL',message:'上游只返回了部分虚构样本。'}]}));
h.ctx.systemPrompt.context({name:'unrelated-demo-region',order:1,text:'无关区域保持原样'});
try{
  const captured=await invoke(h,tool.name),pointer=archivePointer(captured.value);
  assert.equal(captured.value.outcome,'partial');assert.ok(Buffer.byteLength(captured.text)<=4096);
  let cursor,restored='',pages=0;
  do{
    const {value}=await invoke(h,'dafeiyu_tool_feedback_open',{ref:pointer.ref,expectedVersion:'1',section:'data',...(cursor?{cursor}:{})});
    assert.equal(value.status,'ok');assert.equal(value.originalCompleteness,'partial');restored+=value.text;cursor=value.nextCursor;pages++;
    if(pages>100)throw new Error('Pagination did not converge');
  }while(cursor);
  assert.equal(restored,data);assert.equal(tool.calls,1);
  const foreign=await h.probe('other',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:1}));assert.equal(foreign.status,'not_found');
  const deletion=await h.probe('a',c=>h.memory.feedbackDelete(c,{ref:pointer.ref,expectedVersion:1,requestId:randomUUID(),reason:'虚构明确删除'}));assert.equal(deletion.status,'ok');
  const normal=await h.probe('a',c=>h.memory.feedbackOpen(c,{ref:pointer.ref,expectedVersion:2}));assert.equal(normal.status,'not_found');
  const found=await invoke(h,'dafeiyu_tool_feedback_deleted_open',{ref:pointer.ref,expectedVersion:'2',section:'data',offset:String(Array.from(data).length-30)});
  assert.match(found.value.text,/FICTIONAL_TAIL_842/);await nextTurn(h);
  const visible=JSON.stringify(h.adapter.requests.at(-1)?.messages);assert.ok(!visible.includes('FICTIONAL_TAIL_842'));assert.match(visible,/无关区域保持原样/);
  const result={at:new Date().toISOString(),projectVersion:'0.8.0',dsh:'0.2.1-rc.2',model:'scripted',data:'fictional-Chinese',serverAccess:false,
    originalDataBytes:Buffer.byteLength(data),briefBytes:Buffer.byteLength(captured.text),pages,roundTripEqual:true,
    outcome:captured.value.outcome,completeness:captured.value.completeness,toolExecutions:tool.calls,
    crossConversation:'not_found',normalReadAfterDelete:'not_found',deletedLookupSucceeded:true,
    deletedPageRetiredNextTurn:true,unrelatedRegionPreserved:true};
  await writeFile(resolve(root,'result.json'),JSON.stringify(result,null,2)+'\n');
  await writeFile(resolve('docs/memory-phase-5a-results.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
}finally{tool.handle.dispose();await h.close();}
