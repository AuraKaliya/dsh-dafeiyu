import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,readdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { AudioPipeline,audioConfigSchema,pcmInfo } from '../packages/media/lib/audio.js';
import type { AudioWorker } from '../packages/media/lib/audio.js';
import { BoundedProcess } from '../packages/media/lib/process.js';
import { SystemSpeech } from '../packages/media/lib/tts.js';
import { testTempDir } from './test-temp.js';
import { syntheticPcm } from './media-pcm-fixture.js';
const requestSchema=z.object({input:z.string(),inputSha256:z.string(),samples:z.number(),model:z.object({sha256:z.string()}),labels:z.object({sha256:z.string()}).optional()});
async function fixture(){const root=await mkdtemp(join(testTempDir(),'media-audio-')),work=join(root,'work');await mkdir(work);const model=join(root,'fake-model'),labels=join(root,'fake-labels');await writeFile(model,'scripted-model');await writeFile(labels,'scripted-labels');
  const pin=async(path:string)=>({path,sha256:createHash('sha256').update(await readFile(path)).digest('hex')});const config=audioConfigSchema.parse({whisper:{node:process.execPath,moduleDirectory:root,moduleVersion:'1.1.3',model:await pin(model)},events:{python:'fixture-python.exe',model:await pin(model),labels:await pin(labels),numpyVersion:'fixture',onnxruntimeVersion:'fixture'}});
  const data=syntheticPcm(),audio={data,samples:16000,startMs:2500,endMs:3500,requestedEndMs:3500,completeness:'complete' as const};return {root,work,config,audio};}
function backend(change:{range?:boolean;tail?:boolean;silence?:boolean;failEvents?:boolean}={}):AudioWorker{return {run:async spec=>{const request=requestSchema.parse(JSON.parse(await readFile(spec.arguments[1]!,'utf8')));assert.equal(pcmInfo(await readFile(request.input)).sha256,request.inputSha256);
  let result:unknown;if(spec.arguments[0]!.endsWith('whisper.cjs'))result={schemaVersion:1,kind:'asr',inputSha256:request.inputSha256,samples:request.samples,backend:'whisper.node',version:'1.1.3',modelSha256:request.model.sha256,completed:true,segments:change.silence?[]:[{startMs:0,endMs:change.range?2000:1000,text:'模拟转写，非真实识别'}]};
  else{if(change.failEvents)throw new Error('MEDIA_WORKER_TIMEOUT');result={schemaVersion:1,kind:'events',inputSha256:request.inputSha256,samples:request.samples,backend:'yamnet-onnx',modelSha256:request.model.sha256,labelsSha256:request.labels!.sha256,onnxruntimeVersion:'fixture',numpyVersion:'fixture',windows:[{startMs:0,endMs:change.tail?900:1000,scores:[{label:change.silence?'Silence':'Speech',score:0.4}]}]};}
  return {stdout:Buffer.from(JSON.stringify(result)),stderr:Buffer.alloc(0),memoryLimitBytes:spec.memoryBytes,peakCommitBytes:100};}};}

test('audio adapters bind exact PCM and pinned models, align timestamps and preserve raw score meaning',async()=>{
  const f=await fixture(),pipeline=new AudioPipeline(f.work,f.config,backend()),result=await pipeline.read(f.audio,new AbortController().signal,()=>{});
  assert.equal(result.technicalCompleteness,'complete');assert.equal(result.speechDetected,true);assert.equal(result.asr.status,'complete');if(result.asr.status==='complete')assert.equal(result.asr.segments[0]?.startMs,2500);
  assert.equal(result.events.status,'complete');if(result.events.status==='complete')assert.equal(result.events.windows.at(-1)?.endMs,3500);assert.equal(result.scoreMeaning,'raw-model-score-not-probability');assert.deepEqual(await readdir(f.work),[]);
});

test('out-of-range ASR, missing event tails and backend timeout remain distinct partial results',async()=>{
  const f=await fixture();for(const [change,which,expected] of [[{range:true},'asr','MEDIA_ASR_RANGE_INVALID'],[{tail:true},'events','MEDIA_EVENTS_TAIL_MISSING'],[{failEvents:true},'events','MEDIA_WORKER_TIMEOUT']] as const){
    const result=await new AudioPipeline(f.work,f.config,backend(change)).read(f.audio,new AbortController().signal,()=>{});assert.equal(result.technicalCompleteness,'partial');const part=result[which];assert.equal(part.status,'failed');if(part.status==='failed')assert.equal(part.code,expected);}
  const silent=await new AudioPipeline(f.work,f.config,backend({silence:true})).read(f.audio,new AbortController().signal,()=>{});assert.equal(silent.speechDetected,false);assert.deepEqual(await readdir(f.work),[]);
});

test('changed models cannot be loaded, and cancellation or source revocation cannot turn into a partial success',async()=>{
  const f=await fixture();await writeFile(f.config.whisper!.model.path,'changed');const rejected=await new AudioPipeline(f.work,f.config,backend()).read(f.audio,new AbortController().signal,()=>{});assert.equal(rejected.asr.status,'failed');assert.equal(rejected.events.status,'failed');assert.ok(rejected.gaps.includes('MEDIA_MODEL_HASH_CHANGED'));
  await assert.rejects(new AudioPipeline(f.work,f.config,backend()).read(f.audio,new AbortController().signal,()=>{throw new Error('SOURCE_STALE');}),/SOURCE_STALE/);
  const abort=new AbortController();abort.abort();await assert.rejects(new AudioPipeline(f.work,f.config,backend()).read(f.audio,abort.signal,()=>{}));assert.deepEqual(await readdir(f.work),[]);
});

test('Whisper worker actually consumes a synthetic WAV and releases its injected binding without running a model',async()=>{
  const f=await fixture(),moduleDirectory=join(f.root,'binding');await mkdir(moduleDirectory);await writeFile(join(moduleDirectory,'package.json'),JSON.stringify({name:'@fugood/whisper.node',version:'1.1.3',main:'index.cjs'}));
  await writeFile(join(moduleDirectory,'index.cjs'),`let released=false;process.on('exit',()=>{if(!released)process.exitCode=1});exports.toggleNativeLog=async()=>{};exports.initWhisper=async()=>({transcribeFile:input=>({promise:require('node:fs/promises').readFile(input).then(data=>({isAborted:false,segments:[{t0:0,t1:(data.length-44)/32,text:'SCRIPTED_BINDING'}]}))}),release:async()=>{released=true}});`);
  const result=await new AudioPipeline(f.work,{whisper:{...f.config.whisper!,moduleDirectory}},new BoundedProcess(f.work)).read(f.audio,new AbortController().signal,()=>{});
  assert.equal(result.asr.status,'complete');if(result.asr.status==='complete')assert.equal(result.asr.segments[0]?.text,'SCRIPTED_BINDING');assert.equal(result.events.status,'unavailable');assert.deepEqual(await readdir(f.work),[]);
});

test('Python window coverage and format validation run with injected scores and no ONNX model',async()=>{
  const f=await fixture(),worker=new BoundedProcess(f.work);const result=await worker.run({executable:process.env.DAFEIYU_TEST_AUDIO_PYTHON??process.env.DAFEIYU_TEST_DOCUMENT_PYTHON??'C:/Users/Administrator/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe',arguments:[resolve('tests/media_audio_worker_test.py'),resolve('packages/media/workers/audio_events.py')],timeoutMs:10000,memoryBytes:256*1024**2,maxStdoutBytes:1024,maxStderrBytes:8192,signal:new AbortController().signal});
  assert.match(result.stdout.toString('utf8'),/"passed": true/);assert.deepEqual(await readdir(f.work),[]);
});

test('optional TTS binds final approved text and validates output, without invoking a real speech engine',async()=>{
  const f=await fixture(),text='已经批准的最终文本',textHash=createHash('sha256').update(text).digest('hex');let calls=0,valid=true;
  const tts=new SystemSpeech(f.work,{powershell:'fixture.exe',voice:'fixture-ordinary-voice'},{run:async spec=>{calls++;const request=JSON.parse(await readFile(spec.arguments.at(-1)!,'utf8'));assert.equal(request.text,text);return {stdout:f.audio.data.subarray(44),stderr:Buffer.alloc(0),memoryLimitBytes:spec.memoryBytes,peakCommitBytes:100};}});
  const result=await tts.synthesize({text,textHash,guard:()=>{if(!valid)throw new Error('SOURCE_STALE');}},new AbortController().signal);assert.equal(result.samples,16000);assert.equal(result.textHash,textHash);
  await assert.rejects(tts.synthesize({text:'换掉文本',textHash,guard:()=>{}},new AbortController().signal),/UNAPPROVED/);valid=false;await assert.rejects(tts.synthesize({text,textHash,guard:()=>{throw new Error('SOURCE_STALE');}},new AbortController().signal),/SOURCE_STALE/);assert.equal(calls,1);assert.deepEqual(await readdir(f.work),[]);
});
