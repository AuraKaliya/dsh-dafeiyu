import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,symlink } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { captureRuntimeIdentity,runtimeIdentityHash,cleanEvaluationRevision } from '../../scripts/evaluation/identity.ts';
import { EvaluationCatalog } from '../../scripts/evaluation/catalog.ts';
import { EvaluationWorkspace } from '../../scripts/evaluation/workspace.ts';
if(!process.env.DAFEIYU_TEST_RUN||!tmpdir().startsWith(process.env.DAFEIYU_TEST_RUN))throw new Error('MANAGED_TEST_RUN_REQUIRED');

test('runtime identity binds actual builds and dependency files while clean-code checks preserve unrelated documents',async()=>{
  const parent=await mkdtemp(join(tmpdir(),'eval-identity-')),root=join(parent,'fixture');
  for(const path of ['scripts/evaluation','packages/core/lib','node_modules/@dafeiyu','node_modules/typescript','node_modules/example-dependency','docs'])await mkdir(join(root,path),{recursive:true});
  for(const path of ['package.json','package-lock.json','node_modules/typescript/package.json'])await writeFile(join(root,path),'{}');
  for(const path of ['scripts/evaluation/example.ts','scripts/prepare-integrated-acceptance.mjs','scripts/run-integrated-offline.mjs','packages/core/lib/index.js','node_modules/example-dependency/index.js'])await writeFile(join(root,path),'export const fixture=1;');
  await writeFile(join(root,'.gitignore'),'node_modules/\npackages/*/lib/\n');
  await symlink(join(root,'packages/core'),join(root,'node_modules/@dafeiyu/core'),'junction');
  const git=(args:string[])=>execFileSync('git',args,{cwd:root,encoding:'utf8',stdio:['ignore','pipe','pipe']});
  git(['init','-q']);git(['add','.']);git(['-c','user.name=Evaluation Fixture','-c','user.email=evaluation@example.invalid','commit','-qm','fixture']);
  const revision=cleanEvaluationRevision(root),first=await captureRuntimeIdentity(root);assert.equal(revision.length,40);
  await writeFile(join(root,'docs/user-note.md'),'preserved');assert.equal(cleanEvaluationRevision(root),revision);
  await writeFile(join(root,'packages/core/lib/index.js'),'export const fixture=2;');assert.notEqual(runtimeIdentityHash(await captureRuntimeIdentity(root)),runtimeIdentityHash(first));
  await writeFile(join(root,'scripts/evaluation/example.ts'),'export const fixture=3;');assert.throws(()=>cleanEvaluationRevision(root),/CODE_NOT_COMMITTED/);
  const repo=resolve('.'),workspace=await EvaluationWorkspace.create(repo,join(parent,'run'),new EvaluationCatalog(repo),revision,first);workspace.close();
  const reopened=await EvaluationWorkspace.open(repo,join(parent,'run'));assert.equal(reopened.config.runtimeHash,runtimeIdentityHash(first));reopened.close();
  await writeFile(join(parent,'run/runtime-identity.json'),'{}');await assert.rejects(EvaluationWorkspace.open(repo,join(parent,'run')));
});

test('installed local runtime identity includes built packages and DSH code without private runtime data',async()=>{
  const identity=await captureRuntimeIdentity(resolve('.'));assert.ok(identity.files.some(f=>f.path.startsWith('packages/core/lib/')));assert.ok(identity.files.some(f=>f.path.startsWith('node_modules/@deepseek-ai/dsh-agent/')));assert.ok(identity.files.every(f=>!f.path.startsWith('.runtime/')));assert.ok(identity.workspaceLinks.length>0);
});
