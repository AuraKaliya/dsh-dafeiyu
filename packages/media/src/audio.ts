import { z } from 'zod';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { BoundedProcess,contained } from './process.js';
import type { WorkerSpec,WorkerResult } from './process.js';
import { hashFile } from './files.js';

const pinned=z.strictObject({path:z.string().min(1),sha256:z.string().regex(/^[a-f0-9]{64}$/)});
export const audioConfigSchema=z.strictObject({
  whisper:z.strictObject({node:z.string().min(1),moduleDirectory:z.string().min(1),moduleVersion:z.literal('1.1.3').default('1.1.3'),model:pinned,language:z.string().regex(/^(auto|[a-z]{2,3})$/).default('auto'),memoryBytes:z.number().int().min(128*1024**2).max(2*1024**3).default(512*1024**2)}).optional(),
  events:z.strictObject({python:z.string().min(1),model:pinned,labels:pinned,onnxruntimeVersion:z.string().min(1),numpyVersion:z.string().min(1),memoryBytes:z.number().int().min(128*1024**2).max(2*1024**3).default(512*1024**2)}).optional(),
});
export type AudioConfig=z.output<typeof audioConfigSchema>;
export interface PcmAudio {data:Buffer;samples:number;startMs:number;endMs:number;requestedEndMs:number;completeness:'complete'|'partial'}
const segment=z.strictObject({startMs:z.number().finite().nonnegative(),endMs:z.number().finite().nonnegative(),text:z.string().max(8000)}).refine(v=>v.endMs>=v.startMs);
const scored=z.strictObject({label:z.string().min(1).max(200),score:z.number().finite()});
const asrSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('asr'),inputSha256:z.string().length(64),samples:z.number().int().positive(),backend:z.literal('whisper.node'),version:z.literal('1.1.3'),modelSha256:z.string().length(64),
  completed:z.literal(true),segments:z.array(segment).max(1000)});
const eventSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('events'),inputSha256:z.string().length(64),samples:z.number().int().positive(),backend:z.literal('yamnet-onnx'),modelSha256:z.string().length(64),labelsSha256:z.string().length(64),
  onnxruntimeVersion:z.string(),numpyVersion:z.string(),windows:z.array(z.strictObject({startMs:z.number().nonnegative().finite(),endMs:z.number().positive().finite(),scores:z.array(scored).min(1).max(5)})).min(1).max(256)});
export interface AudioWorker {run(spec:WorkerSpec):Promise<WorkerResult>}
const code=(error:unknown)=>error instanceof Error&&/^[A-Z0-9_]{1,100}$/.test(error.message)?error.message:'MEDIA_AUDIO_BACKEND_FAILED';

export function pcmInfo(data:Buffer){
  if(data.length<46||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,16)!=='WAVEfmt '||data.readUInt32LE(16)!==16||data.readUInt16LE(20)!==1||data.readUInt16LE(22)!==1||data.readUInt32LE(24)!==16000||data.readUInt16LE(34)!==16||data.toString('ascii',36,40)!=='data'||data.readUInt32LE(40)!==data.length-44||data.readUInt32LE(4)!==data.length-8||(data.length-44)%2)throw new Error('MEDIA_PCM_INVALID');
  const samples=(data.length-44)/2;if(samples>16000*120)throw new Error('MEDIA_AUDIO_LIMIT');return {samples,durationMs:samples/16,sha256:createHash('sha256').update(data).digest('hex')};
}
/** Fixed local backends, executed through the same bounded process boundary as FFmpeg. */
export class AudioPipeline {
  constructor(private readonly root:string,private readonly config:AudioConfig,private readonly worker:AudioWorker=new BoundedProcess(root),private readonly timeoutMs=120000){}
  private async pinned(file:z.infer<typeof pinned>){const actual=await hashFile(file.path);if(actual.sha256!==file.sha256)throw new Error('MEDIA_MODEL_HASH_CHANGED');}
  async read(audio:PcmAudio,signal:AbortSignal,guard:()=>void){const input=pcmInfo(audio.data);if(input.samples!==audio.samples||Math.abs(audio.endMs-audio.startMs-input.durationMs)>0.1)throw new Error('MEDIA_PCM_INVALID');
    const directory=await mkdtemp(join(this.root,'job-')),file=join(directory,'input.wav');await contained(this.root,directory);
    try{guard();signal.throwIfAborted();await writeFile(file,audio.data,{flag:'wx'});
      const common={input:file,inputSha256:input.sha256,samples:input.samples};
      const execute=async(executable:string,script:string,request:unknown,memoryBytes=512*1024**2)=>{guard();signal.throwIfAborted();const path=join(directory,script.endsWith('.py')?'events.json':'asr.json');await writeFile(path,JSON.stringify(request),{flag:'wx'});
        const result=await this.worker.run({executable,arguments:[fileURLToPath(new URL('../workers/'+script,import.meta.url)),path],timeoutMs:this.timeoutMs,memoryBytes,maxStdoutBytes:128*1024,maxStderrBytes:8192,signal});guard();signal.throwIfAborted();return JSON.parse(result.stdout.toString('utf8').replace(/^\uFEFF/,'')) as unknown;};
      let asr:{status:'complete';segments:z.infer<typeof segment>[];backend:string;version:string;modelSha256:string}|{status:'unavailable'|'failed';code:string};
      if(!this.config.whisper)asr={status:'unavailable',code:'MEDIA_ASR_NOT_CONFIGURED'};
      else try{const settings=this.config.whisper;await this.pinned(settings.model);const result=asrSchema.parse(await execute(settings.node,'whisper.cjs',{...common,...settings},settings.memoryBytes));
        if(result.inputSha256!==input.sha256||result.samples!==input.samples||result.modelSha256!==settings.model.sha256||result.segments.some((s,i)=>s.endMs>input.durationMs+1||i>0&&s.startMs<result.segments[i-1]!.startMs))throw new Error('MEDIA_ASR_RANGE_INVALID');
        if(result.segments.reduce((n,s)=>n+s.text.length,0)>8000)throw new Error('MEDIA_TRANSCRIPT_LIMIT');
        asr={status:'complete',segments:result.segments.map(s=>({...s,startMs:s.startMs+audio.startMs,endMs:s.endMs+audio.startMs})),backend:result.backend,version:result.version,modelSha256:result.modelSha256};
      }catch(error){signal.throwIfAborted();guard();asr={status:'failed',code:code(error)};}
      let events:{status:'complete';windows:z.infer<typeof eventSchema>['windows'];backend:string;modelSha256:string;labelsSha256:string;onnxruntimeVersion:string;numpyVersion:string}|{status:'unavailable'|'failed';code:string};
      if(!this.config.events)events={status:'unavailable',code:'MEDIA_EVENTS_NOT_CONFIGURED'};
      else try{const settings=this.config.events;await this.pinned(settings.model);await this.pinned(settings.labels);const result=eventSchema.parse(await execute(settings.python,'audio_events.py',{...common,...settings},settings.memoryBytes));
        if(result.inputSha256!==input.sha256||result.samples!==input.samples||result.modelSha256!==settings.model.sha256||result.labelsSha256!==settings.labels.sha256||result.onnxruntimeVersion!==settings.onnxruntimeVersion||result.numpyVersion!==settings.numpyVersion)throw new Error('MEDIA_EVENTS_IDENTITY_INVALID');
        let covered=0;for(const window of result.windows){if(window.startMs>covered+0.1||window.endMs<=window.startMs||window.endMs>input.durationMs+0.1)throw new Error('MEDIA_EVENTS_COVERAGE_INVALID');covered=Math.max(covered,window.endMs);}
        if(Math.abs(covered-input.durationMs)>0.1)throw new Error('MEDIA_EVENTS_TAIL_MISSING');
        events={...result,status:'complete',windows:result.windows.map(w=>({...w,startMs:w.startMs+audio.startMs,endMs:w.endMs+audio.startMs}))};
      }catch(error){signal.throwIfAborted();guard();events={status:'failed',code:code(error)};}
      guard();const gaps=['ASR和声音标签均是模型推断，未核验说话者身份；未使用字幕'];if(asr.status!=='complete')gaps.push(asr.code);if(events.status!=='complete')gaps.push(events.code);if(audio.completeness!=='complete')gaps.push('音轨实际尾部短于请求区间');
      return {kind:'actual-audio-processing' as const,pcmSha256:input.sha256,samples:input.samples,startMs:audio.startMs,endMs:audio.endMs,requestedEndMs:audio.requestedEndMs,asr,events,
        speechDetected:events.status==='complete'&&events.windows.some(w=>w.scores.some(s=>s.label==='Speech'&&s.score>=0.25)),scoreMeaning:'raw-model-score-not-probability',gaps,
        technicalCompleteness:asr.status==='complete'&&events.status==='complete'&&audio.completeness==='complete'?'complete' as const:'partial' as const};
    }finally{await contained(this.root,directory);await rm(directory,{recursive:true,force:true});}
  }
}
