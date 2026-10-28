import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {testTempDir} from './test-temp.js';

for(const mode of ['unresponsive','receipt-after-cancel'] as const)test(`IPC cancellation settles ${mode} without retry or lost receipt`,async t=>{
  const root=await mkdtemp(join(testTempDir(),'ipc-cancellation-')),file=join(root,'child.mjs');
  await writeFile(file,`import {createDshBridgeClient} from ${JSON.stringify(pathToFileURL(resolve('packages/plugin/lib/bridge-client.js')).href)};
const port=createDshBridgeClient(),controller=new AbortController();
process.on('message',value=>{if(value.type==='fixture.cancel')controller.abort();});
try{const value=await port.execute({catalogVersion:'a'.repeat(64),name:'fixture_write',argumentsJson:'{}'},{authorization:{fixture:true},guard:()=>controller.signal.throwIfAborted()},controller.signal);process.send({type:'fixture.done',value});}
catch(error){process.send({type:'fixture.done',error:error.message});}
finally{process.disconnect();}`);
  const child=spawn(process.execPath,[file],{stdio:['ignore','ignore','ignore','ipc'],windowsHide:true});t.after(()=>{child.kill();});
  let calls=0,cancellations=0;
  const result=await new Promise<{error?:string|undefined;value?:unknown}>((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('IPC_TEST_TIMEOUT')),5000);t.after(()=>clearTimeout(timer));
    child.on('error',reject);child.on('message',(raw:unknown)=>{const message=z.object({type:z.string(),id:z.string().optional(),error:z.string().optional(),value:z.unknown().optional()}).parse(raw);
      if(message.type==='dsh.call'){calls++;child.send({type:'fixture.cancel'});}
      if(message.type==='dsh.cancel'){cancellations++;if(mode==='receipt-after-cancel')child.send({type:'dsh.result',id:message.id,value:{isError:false,effect:'confirmed',value:{saved:true}}});}
      if(message.type==='fixture.done'){clearTimeout(timer);resolve(message);}
    });
  });
  assert.equal(calls,1);assert.equal(cancellations,1);
  if(mode==='unresponsive')assert.equal(result.error,'DSH_TOOL_OUTCOME_UNKNOWN');
  else{assert.equal(result.error,undefined);assert.deepEqual(result.value,{isError:false,effect:'confirmed',value:{saved:true}});}
});
