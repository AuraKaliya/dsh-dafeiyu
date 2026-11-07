import {setTimeout as delay} from 'node:timers/promises';

export type StageObservation =
  | {state:'active'; phase:string; progressId:string; deadlineAt:number|null}
  | {state:'finished'; result:unknown}
  | {state:'failed'; code:string};

/** Driver watchdog only: a real stage deadline takes precedence over a generic inactivity timeout. */
export async function waitForStage(read:()=>Promise<StageObservation>,options:{signal:AbortSignal;inactivityMs:number;
  now?:()=>number;sleep?:(milliseconds:number,signal:AbortSignal)=>Promise<void>}) {
  const now=options.now??Date.now,sleep=options.sleep??(async(ms,signal)=>{await delay(ms,undefined,{signal});});
  if (!Number.isFinite(options.inactivityMs)||options.inactivityMs<=0) throw new Error('ACCEPTANCE_WAIT_CONFIGURATION');
  let progress:string|null=null,lastProgressAt=now();
  for (;;) {
    options.signal.throwIfAborted();
    const observation=await read();
    options.signal.throwIfAborted();
    if (observation.state==='finished') return observation.result;
    if (observation.state==='failed') throw new Error('ACCEPTANCE_STAGE_FAILED',{cause:{code:observation.code}});
    const at=now();
    if (observation.progressId!==progress) {progress=observation.progressId;lastProgressAt=at;}
    if (observation.deadlineAt!==null&&!Number.isFinite(observation.deadlineAt)) throw new Error('ACCEPTANCE_STAGE_DEADLINE_INVALID');
    const deadline=observation.deadlineAt??lastProgressAt+options.inactivityMs;
    if (at>=deadline) throw new Error('ACCEPTANCE_STAGE_TIMEOUT',{cause:{phase:observation.phase,deadlineAt:deadline,lastProgressAt}});
    await sleep(Math.min(500,deadline-at),options.signal);
  }
}
