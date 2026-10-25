import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,writeFile,readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import { MediaService,MEDIA_ACTIONS } from '@dafeiyu/media';
import type { MediaSourceDescription } from '@dafeiyu/contracts';
import { executionHarness } from './execution-fixture.js';
import { syntheticPcm } from './media-pcm-fixture.js';
import { call,textReply } from './harness.js';
import { testTempDir } from './test-temp.js';

test('core media action processes the actual selected audio interval and exposes separate ASR and sound provenance',async()=>{
  const root=await mkdtemp(join(testTempDir(),'media-audio-service-')),dataDir=join(root,'core'),model=join(root,'model-fixture'),data=syntheticPcm(32000);await writeFile(model,'scripted');const modelHash=createHash('sha256').update('scripted').digest('hex');let step=0;
  const description:MediaSourceDescription={ref:{provider:'fixture',key:'record'},origin:{provider:'fixture',scene:{channel:'fixture',account:'local',kind:'local',id:'audio'},key:'record',version:1,hash:'b'.repeat(64),roots:['fixture:audio'],detail:{}},kind:'audio',name:'record.wav',mimeHint:'audio/wav',bytesHint:data.length,durationMsHint:2000,rangeReadable:false,publicContent:false};
  const h=await executionHarness(root,()=>++step===1?call('dafeiyu_media_read',{requestId:'clip',source:description.ref,mode:'audio',interval:{startMs:500,endMs:1500}}):textReply('仅处理了指定的一秒音轨'),{id:'fixture',version:'1',resourceProofs:{current:p=>p.hash===description.origin.hash,epoch:()=>''}},true,
    {sourceTracking:true,extraActions:[...MEDIA_ACTIONS],resources:[description.origin.scene],beforeActivate:async ctx=>{
      const media=new MediaService(ctx,{agentId:'dafeiyu',profileId:'test',dataDir,createStore:true,ffmpeg:process.env.DAFEIYU_TEST_FFMPEG??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffmpeg.exe',ffprobe:process.env.DAFEIYU_TEST_FFPROBE??'D:/ffmpeg/ffmpeg-8.1-essentials_build/bin/ffprobe.exe',audio:{whisper:{node:process.execPath,moduleDirectory:root,moduleVersion:'1.1.3',model:{path:model,sha256:modelHash}}}},
        {audioWorker:{run:async spec=>{const request=z.object({inputSha256:z.string(),samples:z.number()}).parse(JSON.parse(await readFile(spec.arguments[1]!,'utf8')));assert.equal(request.samples,16000);
          return {stdout:Buffer.from(JSON.stringify({schemaVersion:1,kind:'asr',...request,backend:'whisper.node',version:'1.1.3',modelSha256:modelHash,completed:true,segments:[{startMs:0,endMs:1000,text:'虚构音轨转写'}]})),stderr:Buffer.alloc(0),peakCommitBytes:100,memoryLimitBytes:spec.memoryBytes};}}});
      ctx.dafeiyu.registerMediaProvider({id:'fixture',describe:()=>description,open:async()=>({bytes:data.length,mime:'audio/wav',stream:(async function*(){yield data;})()})});await media.recover();media.activate();
    }});
  try{const run=h.port.submitTask({requestId:'audio',title:'音轨样本',goal:'只读取指定音轨区间',policyId:'test-policy'});await h.core.whenIdle();assert.equal(h.port.status(run.run).operations[0]?.status,'succeeded',JSON.stringify(h.adapter.requests));
    const db=new DatabaseSync(join(dataDir,'media.sqlite'),{readOnly:true});try{const row=JSON.parse(String(db.prepare('SELECT body FROM media_exposures').get()?.body));assert.equal(row.coverage.processed[0].start,500);assert.equal(row.coverage.processed[0].end,1500);assert.equal(row.detail.asr.segments[0].startMs,500);assert.equal(row.detail.events.status,'unavailable');assert.equal(row.detail.speechDetected,false);assert.match(row.text,/MEDIA_EVENTS_NOT_CONFIGURED/);}finally{db.close();}
  }finally{await h.ctx.dafeiyuMedia.close();await h.close();}
});
