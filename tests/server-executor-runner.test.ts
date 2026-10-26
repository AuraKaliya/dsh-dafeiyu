import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,readFile,writeFile,appendFile } from 'node:fs/promises';
import { createReadStream,existsSync } from 'node:fs';
import { createHash,randomUUID } from 'node:crypto';
import { join,resolve } from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { runExecutorNode,executorSpawnOptions,ExecutorNodeCommandSchema } from '../packages/server-executor/lib/runner.js';
import type { ExecutorNodeCommand,ExecutorProcessControl,ExecutorNodeRunOptions } from '../packages/server-executor/lib/runner.js';
import type { ExecutionBudgetRequest } from '../packages/server-executor/lib/budget.js';
import { ScriptedExecutorBudget,executorRoute } from './server-executor-fixture.js';
import { testTempDir } from './test-temp.js';

async function hashFile(file:string){const hash=createHash('sha256');for await(const chunk of createReadStream(file))hash.update(chunk);return hash.digest('hex');}
const entry=resolve('tests/fixtures/server-executor-child.mjs');
/** Test-only cleanup owns this exact ChildProcess handle; it never acts on a supplied numeric PID. */
async function stopFixtureChild(child:ChildProcess,signal:NodeJS.Signals='SIGTERM'):Promise<boolean>{
  const hasExited=()=>child.exitCode!==null||child.signalCode!==null;if(hasExited())return true;child.ref();
  return new Promise<boolean>(resolveDone=>{
    let done=false;const finish=(verified:boolean)=>{if(done)return;done=true;clearTimeout(timeout);clearInterval(poll);child.removeListener('exit',onExit);resolveDone(verified);};
    const onExit=()=>finish(true),timeout=setTimeout(()=>finish(hasExited()),2000),poll=setInterval(()=>{if(hasExited())finish(true);},25);
    child.once('exit',onExit);if(hasExited()){finish(true);return;}
    try{child.kill(signal);}catch{finish(hasExited());}
  });
}
async function fixture(scenario='normal',calls=3){
  const root=await mkdtemp(join(testTempDir(),'executor-node-')),profilePath=join(root,'profile.json');await writeFile(profilePath,JSON.stringify({fixture:true,scenario,calls}));await writeFile(join(root,'permits.ndjson'),'');
  const nodeHash=await hashFile(process.execPath),entryHash=await hashFile(entry),profileHash=await hashFile(profilePath);
  const command:ExecutorNodeCommand={nodePath:process.execPath,entryPath:entry,cwd:root,args:[profilePath],nodeHash,entryHash,profilePath,profileHash,
    env:{...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{}),...(process.env.WINDIR?{WINDIR:process.env.WINDIR}:{}),TEMP:root,TMP:root}};
  class Port extends ScriptedExecutorBudget {override async reserve(input:ExecutionBudgetRequest,signal:AbortSignal){const permit=await super.reserve(input,signal);await appendFile(join(root,'permits.ndjson'),JSON.stringify({callId:input.callId,reservationId:permit.reservationId,purpose:input.purpose})+'\n');return permit;}}
  const port=new Port(),creationId='simulated-creation-'+randomUUID();let child:ChildProcess|undefined,claims=0,running=0,terminations=0,identifyCount=0,changedIdentity=false;
  // ChildProcess lifecycle is real. OS creation time/token validation is deliberately simulated in this offline port.
  const control:ExecutorProcessControl={identify:async value=>{child=value;identifyCount++;if(!value.pid)throw new Error('EXECUTOR_PROCESS_IDENTITY_UNPROVEN');return {pid:value.pid,creationId:changedIdentity&&identifyCount>1?creationId+'-changed':creationId,executableHash:nodeHash};},
    terminate:async value=>{terminations++;return {verified:await stopFixtureChild(value)};}};
  const options:ExecutorNodeRunOptions={command,jobId:randomUUID(),nonce:'d'.repeat(64),input:JSON.stringify({goal:'fictional local proof'}),authorizationId:'fictional-parent-budget',route:executorRoute,deadline:Date.now()+15000,budget:port,processControl:control,
    guard:()=>{},beforeSpawn:()=>{claims++;},onReady:()=>{running++;},cancelGraceMs:100};
  return {root,port,command,options,claims:()=>claims,running:()=>running,terminations:()=>terminations,changeIdentity:()=>{changedIdentity=true;},
    cleanup:async()=>{if(child){let confirmed=await stopFixtureChild(child);if(!confirmed)confirmed=await stopFixtureChild(child,'SIGKILL');if(!confirmed)child.unref();assert.equal(confirmed,true,'FIXTURE_CLEANUP_UNCONFIRMED');}},
    dispatches:async()=>existsSync(join(root,'dispatch.ndjson'))?(await readFile(join(root,'dispatch.ndjson'),'utf8')).trim().split('\n').filter(Boolean).map(line=>JSON.parse(line) as {ordinal:number;purpose:string;permit:string}):[]};
}

test('real Node child waits for handshake and parent reserve, uses scripted DSH for all purposes, and only returns filtered evidence',async()=>{
  const f=await fixture(),previous=process.env.EXECUTOR_UNEXPECTED_SECRET;process.env.EXECUTOR_UNEXPECTED_SECRET='SYNTHETIC_ENV_MUST_NOT_REACH_CHILD';
  try{const result=await runExecutorNode(f.options);assert.equal(result.spawned,true);assert.equal(result.ready,true);assert.equal(result.finished,true);assert.equal(result.exit?.code,0);assert.deepEqual(result.gaps,[]);
    assert.equal(f.claims(),1);assert.equal(f.running(),1);assert.equal(f.terminations(),0);assert.equal(f.port.admitted.length,3);assert.equal(f.port.settled.length,3);
    assert.deepEqual((await f.dispatches()).map(value=>value.purpose),['task','compaction','session-title']);assert.equal(new Set(f.port.admitted.map(value=>value.sessionHash)).size,3);
    assert.equal(await readFile(join(f.root,'fixture-proof.txt'),'utf8'),'fictional local write completed\n');assert.deepEqual(JSON.parse(await readFile(join(f.root,'env-proof.json'),'utf8')),{unexpectedPresent:false,nodeOptionsPresent:false});
    assert.equal(result.output.final?.kind,'executor-self-report');assert.ok(result.output.counts.stderrBytes>0);assert.ok(!JSON.stringify(result).includes('SYNTHETIC_PRIVATE'));assert.ok(!JSON.stringify(result).includes('SYNTHETIC_TOOL_'));
    const spawn=executorSpawnOptions(f.command);assert.equal(spawn.shell,false);assert.equal(spawn.windowsHide,true);assert.deepEqual(spawn.stdio,['pipe','pipe','pipe','ipc']);assert.equal(spawn.env?.EXECUTOR_UNEXPECTED_SECRET,undefined);
  }finally{if(previous===undefined)delete process.env.EXECUTOR_UNEXPECTED_SECRET;else process.env.EXECUTOR_UNEXPECTED_SECRET=previous;await f.cleanup();}
});
test('changed fixed program hash and unlisted environment fields fail before launch',async()=>{
  const f=await fixture();try{await assert.rejects(runExecutorNode({...f.options,command:{...f.command,entryHash:'0'.repeat(64)}}),/PROGRAM_CHANGED/);assert.equal(f.claims(),0);
    assert.throws(()=>ExecutorNodeCommandSchema.parse({...f.command,env:{...f.command.env,API_KEY:'SYNTHETIC'}}));assert.throws(()=>ExecutorNodeCommandSchema.parse({...f.command,env:{...f.command.env,NODE_OPTIONS:'--import malicious'}}));
  }finally{await f.cleanup();}
});
test('wrong profile handshake never receives task input or makes a model reservation',async()=>{
  const f=await fixture('wrong-profile');try{const result=await runExecutorNode(f.options);assert.equal(result.ready,false);assert.equal(result.finished,false);assert.equal(f.port.admitted.length,0);assert.equal(existsSync(join(f.root,'env-proof.json')),false);assert.ok(result.gaps.includes('EXECUTOR_BINDING_MISMATCH'));
  }finally{await f.cleanup();}
});
test('child crash after dispatch keeps the parent reservation unknown without replay',async()=>{
  const f=await fixture('crash');try{const result=await runExecutorNode(f.options);assert.equal((await f.dispatches()).length,1);assert.equal(f.port.admitted.length,1);assert.equal(f.port.settled.length,1);assert.equal(f.port.settled[0]?.usage,null);assert.equal(result.budget[0]?.state,'unknown');assert.equal(result.finished,false);assert.equal(result.exit?.code,19);
  }finally{await f.cleanup();}
});
test('missing usage prevents a second real child dispatch and never claims successful completion',async()=>{
  const f=await fixture('missing');try{const result=await runExecutorNode(f.options);assert.equal((await f.dispatches()).length,1);assert.equal(result.budget[0]?.state,'unknown');assert.equal(result.finished,false);assert.ok(result.gaps.includes('EXECUTOR_USAGE_UNKNOWN'));assert.equal(existsSync(join(f.root,'fixture-proof.txt')),false);
  }finally{await f.cleanup();}
});
test('revocation cancels a live child and keeps dispatched cost unknown',async()=>{
  const f=await fixture('hang');let live=true;const reserve=f.port.reserve.bind(f.port);f.port.reserve=async(input,signal)=>{const permit=await reserve(input,signal);setTimeout(()=>{live=false;},100);return permit;};
  try{const result=await runExecutorNode({...f.options,guard:()=>{if(!live)throw new Error('EXECUTOR_AUTHORITY_REVOKED');}});assert.equal((await f.dispatches()).length,1);assert.equal(result.budget[0]?.state,'unknown');assert.equal(result.finished,false);assert.ok(result.gaps.includes('EXECUTOR_AUTHORITY_REVOKED'));assert.ok(result.exit,JSON.stringify({gaps:result.gaps,termination:result.termination}));
  }finally{await f.cleanup();}
});
test('termination refuses a changed process creation identity and leaves an explicit unknown gap',async()=>{
  const f=await fixture('stubborn'),abort=new AbortController(),reserve=f.port.reserve.bind(f.port);f.changeIdentity();f.port.reserve=async(input,signal)=>{const permit=await reserve(input,signal);setTimeout(()=>abort.abort(),150);return permit;};
  try{const result=await runExecutorNode({...f.options,signal:abort.signal});assert.equal(f.terminations(),0);assert.equal(result.termination.requested,false);assert.ok(result.gaps.includes('EXECUTOR_PROCESS_IDENTITY_CHANGED'));assert.equal(result.exit,null);assert.equal(result.budget[0]?.state,'unknown');
  }finally{await f.cleanup();}
});
