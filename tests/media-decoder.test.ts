import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { testTempDir } from './test-temp.js';
import { BoundedProcess } from '../packages/media/lib/process.js';
import { MediaDecoder } from '../packages/media/lib/decoder.js';
import { MediaRangeBroker } from '../packages/media/lib/range-broker.js';
import { createImageFixture } from './phase1-image-fixture.js';
import { byteChunks } from './media-io-fixture.js';

const tools={ffmpeg:process.env.DAFEIYU_TEST_FFMPEG??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe',ffprobe:process.env.DAFEIYU_TEST_FFPROBE??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffprobe.exe'};
async function fixture(){const root=await mkdtemp(join(testTempDir(),'media-decoder-')),process=new BoundedProcess(root),decoder=new MediaDecoder(process,root,tools);return {root,process,decoder,signal:new AbortController().signal};}

test('actual FFmpeg decodes generated PNG bytes without any model or filename answer',async()=>{
  const f=await fixture(),file=join(f.root,'input.bin'),source=createImageFixture(127);await writeFile(file,source.data);
  const inspected=await f.decoder.inspect({file},f.signal);assert.equal(inspected.kind,'image');assert.equal(inspected.width,480);const image=await f.decoder.image({file},f.signal);
  assert.equal(image.width,480);assert.equal(image.height,320);assert.equal(image.mime,'image/png');assert.equal(image.ptsMs,null);assert.ok(image.data.length>100);
});

test('actual video frames carry presentation timestamps and audio clipping uses measured PCM coverage',async()=>{
  const f=await fixture(),file=join(f.root,'synthetic.mp4');await f.process.run({executable:tools.ffmpeg,arguments:['-nostdin','-hide_banner','-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=2:duration=3','-f','lavfi','-i','sine=frequency=440:sample_rate=16000:duration=3','-c:v','mpeg4','-q:v','5','-c:a','aac','-movflags','+faststart','-fs','1048576','-y',file],timeoutMs:10000,memoryBytes:512*1024**2,maxStdoutBytes:1024,maxStderrBytes:8192,signal:f.signal});
  const info=await f.decoder.inspect({file},f.signal);assert.equal(info.kind,'video');assert.ok(info.durationMs!>=2900);
  const frame=await f.decoder.image({file},f.signal,1000);assert.equal(frame.ptsMs,1000);assert.equal(frame.requestedMs,1000);
  const audio=await f.decoder.audio({file},500,1500,f.signal);assert.equal(audio.samples,16000);assert.equal(audio.endMs,1500);assert.equal(audio.data.readUInt32LE(40),32000);
  await assert.rejects(f.decoder.audio({file},0,200000,f.signal),/INTERVAL_INVALID/);
  const bytes=await readFile(file),broker=await MediaRangeBroker.open({bytes:bytes.length,maxBytes:8*bytes.length,guard:()=>{},signal:f.signal,read:async range=>({bytes:range.end-range.start+1,totalBytes:bytes.length,range,mime:'video/mp4',stream:byteChunks(bytes.subarray(range.start,range.end+1))})});
  try{const streamed=await f.decoder.image({broker},f.signal,500);assert.equal(streamed.ptsMs,500);assert.ok(broker.coverage.transferredBytes>0);assert.ok(broker.coverage.ranges.length>0);
    assert.equal((await fetch(broker.url()+'-invalid')).status,404);
  }finally{await broker.close();}
});

test('a Range source must confirm exact byte bounds and cannot exceed its transfer budget',async()=>{
  const f=await fixture(),bytes=Buffer.alloc(100);let valid=true;const broker=await MediaRangeBroker.open({bytes:100,maxBytes:50,guard:()=>{if(!valid)throw new Error('SOURCE_STALE');},signal:f.signal,
    read:async range=>({bytes:range.end-range.start+1,totalBytes:100,range,mime:null,stream:byteChunks(bytes.subarray(range.start,range.end+1))})});
  try{const response=await fetch(broker.url(),{headers:{Range:'bytes=0-9'}});assert.equal(response.status,206);assert.equal((await response.arrayBuffer()).byteLength,10);
    assert.equal((await fetch(broker.url(),{headers:{Range:'bytes=0-2,4-6'}})).status,416);
    await assert.rejects(async()=>{const result=await fetch(broker.url(),{headers:{Range:'bytes=10-59'}});await result.arrayBuffer();});
    assert.equal(broker.coverage.ranges.length,1);assert.equal(broker.coverage.ranges[0]?.end,9);
    valid=false;assert.throws(()=>broker.url(),/SOURCE_STALE/);
  }finally{await broker.close();}
});

test('unconfirmed or stalled range providers fail closed and close cancels pending opens',async()=>{
  const f=await fixture();let stopped=false;
  const wrong=await MediaRangeBroker.open({bytes:100,maxBytes:100,guard:()=>{},signal:f.signal,read:async(_range,signal)=>{signal.addEventListener('abort',()=>{stopped=true;},{once:true});return {bytes:10,mime:null,stream:byteChunks(Buffer.alloc(10))};}});
  try{await assert.rejects(async()=>{const response=await fetch(wrong.url(),{headers:{Range:'bytes=0-9'}});await response.arrayBuffer();});assert.equal(stopped,true);assert.deepEqual(wrong.coverage.ranges,[]);}finally{await wrong.close();}
  let began!:()=>void;const opening=new Promise<void>(resolve=>{began=resolve;});
  const stalled=await MediaRangeBroker.open({bytes:100,maxBytes:100,guard:()=>{},signal:f.signal,read:async()=>{began();return new Promise(()=>{});}});
  const response=fetch(stalled.url()).then(()=>assert.fail('stalled provider must not succeed'),()=>{});await opening;await stalled.close();await response;
});
