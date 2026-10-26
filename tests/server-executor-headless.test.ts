import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile,writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { runExecutorNode } from '../packages/server-executor/lib/runner.js';
import { loadPinnedHeadlessManifest } from '../packages/server-executor/lib/headless-manifest.js';
import { ExecutorParentTransport } from '../packages/server-executor/lib/transport.js';
import { ExecutorChildBudgetClient } from '../packages/server-executor/lib/child.js';
import { ScriptedExecutorBudget,executorIpcPair,executorRoute,executorProfileHash } from './server-executor-fixture.js';
import { headlessFixture,publicFixtureFiles } from './server-executor-headless-fixture.js';

test('fixed headless manifest rejects changed profile code and unpinned home overlays without booting',async()=>{
  const f=await headlessFixture();try{const original=await readFile(f.manifest.profilePatch.path,'utf8');await writeFile(f.manifest.profilePatch.path,original+' ');assert.throws(f.validated.guard,/PROGRAM_CHANGED/);await writeFile(f.manifest.profilePatch.path,original);
    await writeFile(join(f.home,'cordis.patch.yml'),'[]\n');assert.throws(f.validated.guard,/UNPINNED_PROFILE_INPUT/);await assert.rejects(loadPinnedHeadlessManifest(f.manifestPath,'f'.repeat(64)),/MANIFEST_CHANGED/);
    assert.equal(existsSync(join(f.root,'provider-mounted.json')),false);
  }finally{await f.cleanup();}
});
test('actual installed CLI profile boot drives official headless, file and command tools with scripted billing and no raw session archive',async()=>{
  const f=await headlessFixture();try{const result=await runExecutorNode(f.options),diagnostic=JSON.stringify({gaps:result.gaps,outputGaps:result.output.gaps,exit:result.exit,tools:result.tools});
    assert.equal(result.ready,true,diagnostic);assert.equal(result.finished,true,diagnostic);assert.equal(result.exit?.code,0,diagnostic);
    assert.equal(await readFile(join(f.root,'headless-proof.txt'),'utf8'),'official headless file tool proof\n');assert.equal(await readFile(join(f.root,'headless-command-proof.txt'),'utf8'),'official pwsh proof');
    assert.deepEqual(result.tools.map(record=>[record.call.name,record.state]),[['write','completed'],['read','completed'],['pwsh','completed']]);
    assert.ok(f.port.admitted.length>=4);assert.equal(f.port.admitted.length,f.port.settled.length);assert.ok(f.port.settled.every(value=>value.usage!==null));
    assert.equal(result.output.final?.kind,'executor-self-report');const observed=await f.observed();assert.ok(observed.every(value=>!value.unexpectedEnv));
    const permitted=new Set<string>(f.manifest.allowedTools);assert.ok(observed.every(value=>value.tools.every(name=>permitted.has(name))));
    assert.ok(!JSON.stringify(result).includes('SYNTHETIC_HEADLESS_PRIVATE_REASONING_SENTINEL'));
    for(const file of await publicFixtureFiles(f.home)){assert.ok(!file.endsWith('.jsonl'),file);const content=await readFile(file,'utf8');assert.ok(!content.includes('SYNTHETIC_HEADLESS_PRIVATE_REASONING_SENTINEL'),file);}
    assert.equal(existsSync(join(f.home,'logs')),false);assert.equal(existsSync(join(f.home,'sessions')),false);
  }finally{await f.cleanup();}
});
test('actual headless cannot dispatch an SDK write without a parent tool permit',async()=>{
  const f=await headlessFixture();try{const result=await runExecutorNode({...f.options,allowedTools:[]});assert.equal(result.ready,true,JSON.stringify(result.output.gaps));assert.equal(existsSync(join(f.root,'headless-proof.txt')),false);assert.equal(result.tools.length,0);assert.ok(result.gaps.includes('EXECUTOR_TOOL_DENIED'));
  }finally{await f.cleanup();}
});
test('missing usage in actual headless retains unknown cost and prevents its pending file tool',async()=>{
  const f=await headlessFixture('missing');try{const result=await runExecutorNode(f.options);assert.equal(f.port.admitted.length,1,JSON.stringify(result.output.gaps));assert.equal(result.budget[0]?.state,'unknown');assert.equal(result.finished,false);assert.equal(result.tools.length,0);assert.equal(existsSync(join(f.root,'headless-proof.txt')),false);
  }finally{await f.cleanup();}
});
test('tool receipts stay metadata-only and idempotent, and lost tool completion remains unknown',async()=>{
  const pair=executorIpcPair(),port=new ScriptedExecutorBudget(),parent=new ExecutorParentTransport({endpoint:pair.parent,port,jobId:randomUUID(),nonce:'d'.repeat(64),profileHash:executorProfileHash,route:executorRoute,authorizationId:'fixture',deadline:Date.now()+30000,guard:()=>{},allowedTools:['write']}),
    client=new ExecutorChildBudgetClient(pair.child,executorProfileHash),call={callId:randomUUID(),name:'write',sourceCallHash:'a'.repeat(64),sessionHash:'b'.repeat(64),argumentsHash:'c'.repeat(64)};
  try{await client.ready();const permitId=await client.authorizeTool(call);assert.equal(parent.toolSnapshot()[0]?.state,'admitted');await client.finishTool({callId:call.callId,permitId,state:'completed'});assert.equal(parent.toolSnapshot()[0]?.state,'completed');
    await client.finishTool({callId:call.callId,permitId,state:'completed'});const next={...call,callId:randomUUID()};await client.authorizeTool(next);client.close();await parent.close();assert.equal(parent.toolSnapshot()[1]?.state,'unknown');assert.equal(port.admitted.length,0);
    assert.deepEqual(Object.keys(parent.toolSnapshot()[0]!.call).sort(),['argumentsHash','callId','name','sessionHash','sourceCallHash']);
  }finally{client.close();await parent.close();}
});
