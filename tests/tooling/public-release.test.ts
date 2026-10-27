import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,writeFile,readFile,copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve,dirname } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { pathToFileURL } from 'node:url';
import { buildPublicRelease } from '../../scripts/build-public-release.mjs';
import { inspectPublicRelease } from '../../scripts/check-public-release.mjs';

const execute=promisify(execFile);
test('a publishable package installs without private workspaces and runs the same cold-start/restart checks',async()=>{
  const root=await mkdtemp(join(tmpdir(),'public-release-')),release=join(root,'release'),consumer=join(root,'consumer');
  const result=buildPublicRelease(release);assert.ok(result.files>500);assert.equal(inspectPublicRelease(release).passed,true);
  const npm=process.env.npm_execpath??join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js');
  const env={...process.env,npm_config_cache:join(root,'npm-cache')};
  const packed=await execute(process.execPath,[npm,'pack','--json','--ignore-scripts','--pack-destination',root],{cwd:release,env,windowsHide:true,timeout:60000});
  const [pack]=JSON.parse(packed.stdout) as {filename:string;files:{path:string}[]}[];assert.ok(pack);
  assert.ok(!pack.files.some(file=>file.path.startsWith('source/')||file.path.startsWith('.runtime/')||file.path.includes('node_modules/')));
  await mkdir(consumer);await writeFile(join(consumer,'package.json'),JSON.stringify({name:'isolated-public-install',private:true,type:'module'}));
  await execute(process.execPath,[npm,'install',join(root,pack.filename),'--ignore-scripts','--no-audit','--no-fund','--registry=https://registry.npmjs.org'],{cwd:consumer,env,windowsHide:true,timeout:180000,maxBuffer:200000});
  await copyFile(resolve('build-tests/test-temp.js'),join(consumer,'test-temp.js'));
  await copyFile(resolve('build-tests/qq-group-packet-fixture.js'),join(consumer,'qq-group-packet-fixture.js'));
  let fixture=await readFile(resolve('build-tests/installation-runtime-fixture.js'),'utf8');
  fixture=fixture.replace("resolve('profiles/persona.foundation.md')","resolve('node_modules/dsh-dafeiyu/runtime/plugin/assets/foundation.md')");
  await writeFile(join(consumer,'check.mjs'),fixture);
  // Refuse fallback to the development workspace even though test scratch is below it.
  const blocked=[resolve('packages').replaceAll('\\','/').toLowerCase(),resolve('node_modules').replaceAll('\\','/').toLowerCase()];
  await writeFile(join(consumer,'no-workspace.mjs'),`import {registerHooks} from 'node:module';import {fileURLToPath} from 'node:url';const blocked=${JSON.stringify(blocked)};registerHooks({resolve(spec,ctx,next){const result=next(spec,ctx);if(result.url.startsWith('file:')){const file=fileURLToPath(result.url).replaceAll('\\\\','/').toLowerCase();if(blocked.some(path=>file.startsWith(path+'/')))throw new Error('DEVELOPMENT_FALLBACK');}return result;}});`);
  const checked=await execute(process.execPath,['--import',pathToFileURL(join(consumer,'no-workspace.mjs')).href,join(consumer,'check.mjs')],{cwd:consumer,env,windowsHide:true,timeout:30000,maxBuffer:200000});
  assert.equal(JSON.parse(checked.stdout.trim().split('\n').at(-1)!).passed,true);
  const help=await execute(process.execPath,[join(consumer,'node_modules/dsh-dafeiyu/bin/dafeiyu.mjs'),'--help'],{cwd:consumer,env,windowsHide:true,timeout:10000});assert.match(help.stdout,/settings/);
});

test('release privacy checks reject private files and reviewer-supplied private values',async()=>{
  const root=await mkdtemp(join(tmpdir(),'release-privacy-')),release=join(root,'release');buildPublicRelease(release,{includeSource:false});
  await execute('git',['init','-q'],{cwd:release,windowsHide:true});
  const ignored=await execute('git',['check-ignore','--no-index','dafeiyu-data/history.json','settings.local.json','onebot.token'],{cwd:release,windowsHide:true});
  assert.equal(ignored.stdout.trim().split(/\r?\n/).length,3);
  await writeFile(join(release,'.env'),'PRIVATE_RELEASE_SENTINEL');const result=inspectPublicRelease(release,{forbiddenValues:['PRIVATE_RELEASE_SENTINEL']});
  assert.equal(result.passed,false);assert.ok(result.findings.some(f=>f.code==='PRIVATE_FILE'));assert.ok(result.findings.some(f=>f.code==='PRIVATE_LOCAL_VALUE'));assert.ok(!JSON.stringify(result).includes('PRIVATE_RELEASE_SENTINEL'));
});
