import {heavyTask} from './heavy-task-fixture.js';
export type HeavyCrashMode='crash'|'resume';
const mode=process.argv[2];
if(mode!=='crash'&&mode!=='resume')throw new Error('HEAVY_MODE_INVALID');
const result=await heavyTask(new AbortController().signal,mode==='crash'?{crashBeforeSend:true}:{resumeRoot:process.argv[3]!});
process.send?.({type:'heavy-resumed',result});process.disconnect?.();
