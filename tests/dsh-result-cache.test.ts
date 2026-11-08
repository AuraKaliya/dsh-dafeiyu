import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,readdir,utimes} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DshResultReadSchema,DshResultReadBatchSchema} from '@dafeiyu/contracts';
import {DshResultStore} from '../packages/host/lib/dsh-result-store.js';
import {testTempDir} from './test-temp.js';
import {z} from 'zod';

test('related archive pages are read in one batch with their exact individual coverage and execution receipts',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-query-batch-')),store=new DshResultStore(root),task=randomUUID(),id=randomUUID(),other=randomUUID();
  store.save(id,task,null,{isError:true,effect:'unknown',value:{exitCode:7,timedOut:true,stdout:'甲'.repeat(9000),stderr:'fixture-error'}});
  const reads=[{resultId:id,path:[],limit:1000},{resultId:id,path:['stdout'],offset:2000,limit:1000},{resultId:id,path:['stderr'],limit:1000}].map(value=>DshResultReadSchema.parse(value));
  const singles=reads.map(value=>store.read(task,null,value));let guards=0;
  const result=z.object({complete:z.boolean(),items:z.array(z.object({page:z.json()}))}).parse(store.readBatch(task,null,{reads},()=>{guards++;}));
  assert.equal(result.complete,true);assert.equal(guards,4);assert.deepEqual(result.items.map(item=>item.page),singles);
  assert.deepEqual(store.diagnostics(),{diskLoads:1,cacheHits:5,cachedResults:1,cachedBytes:(await readFile(join(root,task+'.'+id+'.result.json'))).length});
  assert.throws(()=>store.read(other,null,reads[0]!),/SCOPE_DENIED/);assert.throws(()=>store.read(task,{channel:'qq',account:'1',kind:'private',id:'2'},reads[0]!),/SCOPE_DENIED/);
  const partial=z.object({complete:z.boolean(),items:z.array(z.object({status:z.string(),code:z.string().optional()}))}).parse(store.readBatch(task,null,{reads:[reads[0]!,DshResultReadSchema.parse({resultId:other})]},()=>{}));
  assert.equal(partial.complete,false);assert.equal(partial.items[0]?.status,'ok');assert.equal(partial.items[1]?.code,'SCOPE_DENIED');
  assert.throws(()=>store.readBatch(task,null,{reads},()=>{if(++guards===6)throw new Error('CANCELLED');}),/CANCELLED/);
  assert.throws(()=>DshResultReadBatchSchema.parse({reads:Array(4).fill({resultId:id,limit:6000})}));
});

test('cached results still detect tampering, keep writes exclusive and reopen after restart',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-query-cache-')),store=new DshResultStore(root,8),task=randomUUID(),id=randomUUID(),file=join(root,task+'.'+id+'.result.json'),request=DshResultReadSchema.parse({resultId:id});
  store.save(id,task,null,{effect:'none',value:'original'});const original=await readFile(file,'utf8'),first=store.read(task,null,request);
  assert.throws(()=>store.save(id,task,null,{value:'replacement'}),/EEXIST/);assert.equal(await readFile(file,'utf8'),original);assert.ok(!(await readdir(root)).some(file=>file.endsWith('.tmp')));
  assert.deepEqual(new DshResultStore(root).read(task,null,request),first);
  await writeFile(file,original.replace('original','tampered'));await utimes(file,new Date(0),new Date(0));
  assert.throws(()=>store.read(task,null,request),/SCOPE_DENIED/);
  await writeFile(file,original);assert.deepEqual(store.read(task,null,request),first);
  for(let index=0;index<10;index++){const next=randomUUID();store.save(next,task,null,{value:String(index)});store.read(task,null,DshResultReadSchema.parse({resultId:next}));}
  assert.equal(store.diagnostics().cachedResults,8);assert.ok(store.diagnostics().cachedBytes<=8*1024*1024);
});

test('fifty pages of one large result reuse one verified parse and retain exact character ranges',async()=>{
  const root=await mkdtemp(join(testTempDir(),'dsh-query-heavy-')),store=new DshResultStore(root),task=randomUUID(),id=randomUUID(),text='范围🙂'.repeat(150000),chars=Array.from(text);
  store.save(id,task,null,{effect:'none',value:text});const started=performance.now();
  for(let index=0;index<50;index++){const offset=index*4000,page=z.object({view:z.object({text:z.string(),coverage:z.object({start:z.number(),end:z.number(),total:z.number(),complete:z.boolean()})})}).parse(store.read(task,null,DshResultReadSchema.parse({resultId:id,offset,limit:4000})));
    assert.equal(page.view.text,chars.slice(offset,offset+4000).join(''));assert.equal(page.view.coverage.total,chars.length);assert.equal(page.view.coverage.complete,false);}
  assert.equal(store.diagnostics().diskLoads,1);assert.equal(store.diagnostics().cacheHits,49);
  console.log(JSON.stringify({kind:'offline-result-pagination',pages:50,durationMs:Math.round(performance.now()-started),...store.diagnostics()}));
});
