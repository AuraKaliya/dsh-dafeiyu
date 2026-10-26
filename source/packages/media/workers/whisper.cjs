'use strict';
// One bounded job. This program has no network/client configuration and logs no raw diagnostics.
const fs=require('node:fs/promises');
const crypto=require('node:crypto');
const path=require('node:path');
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
async function main(){
  const spec=JSON.parse(await fs.readFile(process.argv[2],'utf8'));
  const input=await fs.readFile(spec.input),model=await fs.readFile(spec.model.path);
  if(hash(input)!==spec.inputSha256||hash(model)!==spec.model.sha256||input.length!==spec.samples*2+44||spec.samples>16000*120)throw new Error('INPUT_CHANGED');
  const pkg=JSON.parse(await fs.readFile(path.join(spec.moduleDirectory,'package.json'),'utf8'));
  if(pkg.name!=='@fugood/whisper.node'||pkg.version!=='1.1.3'||pkg.version!==spec.moduleVersion)throw new Error('BACKEND_CHANGED');
  const {initWhisper,toggleNativeLog}=require(spec.moduleDirectory);await toggleNativeLog(false);
  const context=await initWhisper({filePath:spec.model.path,useGpu:false});
  try{const job=context.transcribeFile(spec.input,{language:spec.language,temperature:0,maxThreads:2,tokenTimestamps:true});const result=await job.promise;
    if(result.isAborted||!Array.isArray(result.segments))throw new Error('ASR_INCOMPLETE');
    const segments=result.segments.map(s=>({startMs:s.t0,endMs:s.t1,text:s.text}));
    process.stdout.write(JSON.stringify({schemaVersion:1,kind:'asr',inputSha256:spec.inputSha256,samples:spec.samples,backend:'whisper.node',version:pkg.version,modelSha256:spec.model.sha256,completed:true,segments}));
  }finally{await context.release();}
}
main().catch(()=>{process.stderr.write('MEDIA_ASR_WORKER_FAILED');process.exitCode=1;});
