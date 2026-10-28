import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readdir,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { BoundedProcess } from '../packages/media/lib/process.js';
import { DocumentReader } from '../packages/media/lib/documents.js';
import { testTempDir } from './test-temp.js';
import { executionHarness } from './execution-fixture.js';
import { MediaService,MEDIA_ACTIONS } from '@dafeiyu/media';
import type { MediaSourceDescription } from '@dafeiyu/contracts';
import { call,textReply } from './harness.js';
import { DatabaseSync } from 'node:sqlite';

const python=process.env.DAFEIYU_TEST_DOCUMENT_PYTHON??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe';
test('real Python document parser validates synthetic text, OOXML and PDF fixtures under bounded execution',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-documents-')),process=new BoundedProcess(root),result=await process.run({executable:python,arguments:[resolve('tests/media_document_worker_test.py'),resolve('packages/media/workers/documents.py')],timeoutMs:30000,memoryBytes:512*1024**2,maxStdoutBytes:16000,maxStderrBytes:8192,signal:new AbortController().signal});
  const report=JSON.parse(result.stdout.toString('utf8'));assert.equal(report.passed,true,JSON.stringify(report));assert.equal(report.tests,5);assert.deepEqual(await readdir(root),[]);
});

test('document worker returns exact source hash and cursor, sanitizes errors and cleans every work directory',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-document-reader-')),work=join(root,'work');await mkdir(work);const file=join(root,'text.bin');await writeFile(file,'蓝鱼'.repeat(100));
  const reader=new DocumentReader(work,root,{python,pypdfVersion:'6.10.0'}),signal=new AbortController().signal;
  const first=await reader.read({file,name:'text.txt',offset:0,textOffset:0,limit:40},signal,()=>{});assert.deepEqual(first.next,{offset:0,textOffset:40});
  const next=await reader.read({file,name:'text.txt',offset:first.next!.offset,textOffset:first.next!.textOffset,limit:160},signal,()=>{});assert.equal(first.units[0]!.text+next.units[0]!.text,'蓝鱼'.repeat(100));
  await writeFile(file,Buffer.from([0xff,0xfe,0x61]));await assert.rejects(reader.read({file,name:'unknown.bin',offset:0,textOffset:0,limit:40},signal,()=>{}),/ENCODING_UNSUPPORTED/);assert.deepEqual(await readdir(work),[]);
});

test('document core action records actual located text and stable continuation without invoking a document model',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-document-service-')),dataDir=join(root,'core'),bytes=Buffer.from('这是虚构文档的一段内容。'.repeat(20));let step=0;
  const description:MediaSourceDescription={ref:{provider:'fixture',key:'document'},origin:{provider:'fixture',scene:{channel:'fixture',account:'local',kind:'local',id:'doc'},key:'document',version:1,hash:'c'.repeat(64),roots:['fixture:doc'],detail:{}},kind:'document',name:'fixture.txt',mimeHint:'text/plain',bytesHint:bytes.length,durationMsHint:null,rangeReadable:false,publicContent:false};
  const h=await executionHarness(root,()=>++step<=2?call('dafeiyu_media_read',{requestId:'fragment',source:description.ref,mode:'document',limit:50}):textReply('仅读取了一段文档'),{id:'fixture',version:'1',resourceProofs:{current:p=>p.hash===description.origin.hash,epoch:()=>''}},true,{extraActions:[...MEDIA_ACTIONS],resources:[description.origin.scene],beforeActivate:async ctx=>{
    const media=new MediaService(ctx,{agentId:'dafeiyu',profileId:'test',dataDir,createStore:true,ffmpeg:'not-used.exe',ffprobe:'not-used.exe',documents:{python,pypdfVersion:'6.10.0'}});
    ctx.dafeiyu.registerMediaProvider({id:'fixture',describe:()=>description,open:async()=>({bytes:bytes.length,mime:'text/plain',stream:(async function*(){yield bytes;})()})});await media.recover();media.activate();
  }});
  try{const run=h.port.submitTask({requestId:'document',title:'文档检查',goal:'按需读取同一片段并验证回执',policyId:'test-policy'});await h.core.whenIdle();assert.ok(h.port.status(run.run).operations.every(o=>o.status==='succeeded'),JSON.stringify(h.adapter.requests));
    const db=new DatabaseSync(join(dataDir,'media.sqlite'),{readOnly:true});try{assert.equal(db.prepare('SELECT count(*) AS n FROM media_exposures').get()?.n,1);const body=JSON.parse(String(db.prepare('SELECT body FROM media_exposures').get()?.body));assert.equal(body.detail.next.textOffset,50);assert.match(body.text,/line:1/);}finally{db.close();}
    assert.equal(h.adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-task-')).length,3);assert.equal(h.adapter.requests.filter(request=>String(request.sessionId).startsWith('dafeiyu-review-')).length,0);
  }finally{await h.ctx.dafeiyuMedia.close();await h.close();}
});
