import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {DshResultReadSchema} from '@dafeiyu/contracts';
import {DshResultStore} from '../packages/host/lib/dsh-result-store.js';
import {testTempDir} from './test-temp.js';
import {captureAcceptance} from './acceptance-evidence.js';

test('a normal file read includes actual source lines instead of only a child-array handle',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-result-')),store=new DshResultStore(root),id=randomUUID(),task=randomUUID(),lines=Array.from({length:70},(_,n)=>({number:400+n,text:`if (message.group_id === group_${n}) return allowed;`}));
  store.save(id,task,null,{isError:false,effect:'none',value:{path:'loaded/qq.js',offset:400,lines,totalLines:900}});
  const page=z.object({view:z.object({entries:z.array(z.object({key:z.string(),value:z.json().optional()})),coverage:z.object({complete:z.boolean()})})}).parse(store.read(task,null,DshResultReadSchema.parse({resultId:id})));
  assert.deepEqual(page.view.entries.find(row=>row.key==='lines')?.value,lines);assert.equal(page.view.coverage.complete,true);
  assert.throws(()=>store.read(randomUUID(),null,DshResultReadSchema.parse({resultId:id})),/SCOPE_DENIED/);
  if(process.env.DAFEIYU_ACCEPTANCE_DIR)captureAcceptance('dsh-result-read',{taskId:task,resultId:id,page:store.read(task,null,DshResultReadSchema.parse({resultId:id}))});
});

test('large child results are explicitly unread and can be reconstructed without re-executing the tool',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-result-large-')),store=new DshResultStore(root),id=randomUUID(),task=randomUUID(),lines=Array.from({length:250},(_,n)=>({number:n+1,text:'source '+n+' x'.repeat(80)}));
  store.save(id,task,null,{isError:false,effect:'none',value:{path:'loaded/large.js',lines}});
  const page=z.object({view:z.object({coverage:z.object({listedComplete:z.boolean(),complete:z.boolean()}),unread:z.array(DshResultReadSchema),next:z.json().nullable()})}).parse(store.read(task,null,DshResultReadSchema.parse({resultId:id})));
  assert.equal(page.view.coverage.listedComplete,true);assert.equal(page.view.coverage.complete,false);assert.equal(page.view.next,null);
  let next=page.view.unread[0]!,read:unknown[]=[];
  for(;;){const raw=store.read(task,null,next);assert.ok(Buffer.byteLength(JSON.stringify(raw))<20000);const part=z.object({view:z.object({entries:z.array(z.object({value:z.json()})),next:DshResultReadSchema.nullable()})}).parse(raw);read.push(...part.view.entries.map(row=>row.value));if(!part.view.next)break;next=part.view.next;}
  assert.deepEqual(read,lines);
});

test('result paging redacts before any preview and preserves textual integer precision',async()=>{
  const store=new DshResultStore(await mkdtemp(join(testTempDir(),'dsh-result-safe-'))),id=randomUUID(),task=randomUUID();
  store.save(id,task,null,{isError:false,effect:'none',value:'{"id":9007199254740993,"password":"fictional-private-value","text":"visible"}'});
  const page=store.read(task,null,DshResultReadSchema.parse({resultId:id}));assert.doesNotMatch(JSON.stringify(page),/fictional-private-value/);assert.match(JSON.stringify(page),/9007199254740993/);
});
