import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { redactJson,redactContent,DshResultReadSchema } from '@dafeiyu/contracts';
import { DshResultStore } from '../packages/host/lib/dsh-result-store.js';
import { verifyPersonaDelivery } from '../packages/memory/lib/expression-runtime.js';
import { harness,textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

test('large structured results have scoped child handles and lossless Unicode text pages',async()=>{
  const root=await mkdtemp(join(testTempDir(),'result-pages-')),store=new DshResultStore(root),task=randomUUID(),id=randomUUID(),scene={channel:'qq',account:'1',kind:'private' as const,id:'2'},text='你好😀"反斜线\\\n'.repeat(4000);
  store.save(id,task,scene,{isError:false,effect:'none',value:{title:'论文',text,token:'fictional-secret'}});
  const first=store.read(task,scene,DshResultReadSchema.parse({resultId:id}));assert.match(JSON.stringify(first),/read/);assert.doesNotMatch(await readFile(join(root,task+'.'+id+'.result.json'),'utf8'),/fictional-secret/);
  let offset=0,restored='',pages=0;for(;;){const page=z.object({view:z.object({kind:z.literal('text'),text:z.string(),next:z.object({offset:z.number()}).nullable()})}).parse(store.read(task,scene,DshResultReadSchema.parse({resultId:id,path:['text'],offset,limit:6000})));restored+=page.view.text;pages++;if(!page.view.next)break;offset=page.view.next.offset;}
  assert.equal(restored,text);assert.ok(pages>4);assert.throws(()=>store.read(randomUUID(),scene,DshResultReadSchema.parse({resultId:id})),/SCOPE_DENIED/);
  assert.throws(()=>store.read(task,{...scene,id:'3'},DshResultReadSchema.parse({resultId:id})),/SCOPE_DENIED/);
});

test('redaction is idempotent for structured results, nested serialized JSON and existing markers',()=>{
  const input={token:'fictional-secret',page:JSON.stringify({nested:JSON.stringify({token:'another-secret'}),text:'token=[REDACTED], 说明'})};
  const once=redactJson(input),twice=redactJson(once.value);assert.equal(once.redacted,true);assert.equal(twice.redacted,false);assert.deepEqual(twice.value,once.value);assert.doesNotMatch(JSON.stringify(once.value),/fictional-secret|another-secret/);
  const first=redactContent('token=fictional-secret; password="other"');assert.equal(redactContent(first.value).value,first.value);
  const precise=redactContent('{"id":9007199254740993123,"token":"fixture"}');assert.match(precise.value,/9007199254740993123/);assert.equal(redactContent(precise.value).redacted,false);
});

test('a tool returning JSON text exposes structured records without rounding identifiers',async()=>{
  const root=await mkdtemp(join(testTempDir(),'result-json-text-')),store=new DshResultStore(root),task=randomUUID(),id=randomUUID();
  store.save(id,task,null,{isError:false,effect:'none',value:'{"results":[{"title":"论文","id":9007199254740993123,"score":0.1234567890123456789}],"text":"正文"}'});
  const page=store.read(task,null,DshResultReadSchema.parse({resultId:id,path:['results']}));assert.match(JSON.stringify(page),/9007199254740993123/);assert.match(JSON.stringify(page),/0\.1234567890123456789/);assert.match(JSON.stringify(page),/json-text-numbers-preserved/);
});

test('delivery verification does not rebuild evidence per streamed fragment and rechecks at completion',async t=>{
  const root=await mkdtemp(join(testTempDir(),'verify-stream-'));let stale=false,checks=0;const answer='{"faithful":true,"issues":[]}';
  const h=await harness(root,()=>{stale=true;const chunks=textReply(answer);return [chunks[0]!,...Array.from({length:2000},()=>({type:'text-delta' as const,index:0,text:' '})),...chunks.slice(2)];});t.after(h.close);
  await assert.rejects(verifyPersonaDelivery(h.ctx,{question:'问题',evidence:[{id:'S1',text:'资料'.repeat(10000)}]},'回答',new AbortController().signal,()=>{checks++;if(stale)throw new Error('SOURCE_STALE');},{maxAnswerChars:4000,maxInputBytes:100000}),/SOURCE_STALE/);
  assert.equal(checks,2);
});

test('verification deadline is independent of a long task deadline',async t=>{
  const root=await mkdtemp(join(testTempDir(),'verify-deadline-')),h=await harness(root,async()=>{await new Promise(resolve=>setTimeout(resolve,45));return textReply('{"faithful":true,"issues":[]}');});t.after(h.close);
  await assert.rejects(verifyPersonaDelivery(h.ctx,{question:'问题',evidence:[]},'回答',new AbortController().signal,()=>{},{maxAnswerChars:4000,maxInputBytes:32000,timeoutMs:10}),/DELIVERY_VERIFICATION_TIMEOUT/);
});
