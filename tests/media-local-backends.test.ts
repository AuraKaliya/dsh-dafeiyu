import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,copyFile,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { BoundedProcess,MediaDecoder,mediaConfigSchema } from '@dafeiyu/media';
import { AudioPipeline } from '../packages/media/lib/audio.js';
import { DocumentReader } from '../packages/media/lib/documents.js';
import { testTempDir } from './test-temp.js';

test('selected local formal backends actually decode speech, run ASR and sound events, and parse a document',{skip:!process.env.DAFEIYU_LOCAL_MEDIA_CONFIG,timeout:120000},async()=>{
  const settings=JSON.parse(await readFile(process.env.DAFEIYU_LOCAL_MEDIA_CONFIG!,'utf8')),config=mediaConfigSchema.parse({...settings.media,agentId:'backend-check',profileId:'backend-check',dataDir:'not-used'});
  assert.ok(config.audio?.whisper&&config.audio.events&&config.documents);const root=await mkdtemp(join(testTempDir(),'local-backends-')),jobs=join(root,'jobs');await mkdir(jobs);
  const input=join(root,'speech.wav');await copyFile(resolve('.runtime/phase1-probes/audio/fixtures/speech-zh.wav'),input);const signal=AbortSignal.timeout(90000);
  const decoder=new MediaDecoder(new BoundedProcess(jobs),root,{ffmpeg:config.ffmpeg,ffprobe:config.ffprobe}),audio=await decoder.audio({file:input},0,7500,signal);
  const read=await new AudioPipeline(jobs,config.audio).read(audio,signal,()=>{});assert.equal(read.asr.status,'complete',JSON.stringify(read.asr));assert.equal(read.events.status,'complete',JSON.stringify(read.events));
  if(read.asr.status==='complete')assert.match(read.asr.segments.map(s=>s.text).join(''),/大[飛飞][魚鱼]|蓝色|藍色/);
  const doc=join(root,'fixture.txt');await writeFile(doc,'本地正式文档处理器核验，保留这一行。');const parsed=await new DocumentReader(jobs,root,config.documents).read({file:doc,name:'fixture.txt',offset:0,textOffset:0,limit:1000},signal,()=>{});
  assert.ok(parsed.units.some(unit=>unit.text.includes('保留这一行')));
});
