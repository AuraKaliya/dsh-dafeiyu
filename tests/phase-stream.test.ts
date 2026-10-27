import test from 'node:test';
import assert from 'node:assert/strict';
import type {StreamChunk} from '@deepseek-ai/dsh-llm';
import {phaseStream} from '../packages/core/lib/phase-stream.js';

test('a phase deadline stops a silent next and does not wait forever for generator cleanup',async()=>{
  const controller=new AbortController();let release!:()=>void,entered!:()=>void;
  const gate=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{entered=resolve;});
  const stream=(async function*():AsyncGenerator<StreamChunk>{entered();await gate;yield {type:'finish',reason:{kind:'stop'}};})();
  let outputs=0;const work=(async()=>{for await(const _chunk of phaseStream(stream,controller.signal))outputs++;})();
  const failed=assert.rejects(work,/phase deadline/);await started;controller.abort(new Error('phase deadline'));let timer:ReturnType<typeof setTimeout>|undefined;
  try{await Promise.race([failed,new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>reject(new Error('deadline did not settle')),1000);})]);assert.equal(outputs,0);}finally{if(timer)clearTimeout(timer);release();}
});
