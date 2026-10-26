import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp,mkdir,readdir,writeFile,readFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { testTempDir } from './test-temp.js';
import { BoundedProcess } from '../packages/media/lib/process.js';

const root=()=>mkdtemp(join(testTempDir(),'media-process-'));
const basic={executable:process.execPath,timeoutMs:5000,memoryBytes:256*1024*1024,maxStdoutBytes:1024,maxStderrBytes:4096,signal:new AbortController().signal};

test('the Windows worker is memory-limited before running and preserves argument bytes without shell expansion',async()=>{
  const directory=await root(),worker=new BoundedProcess(directory),values=['a b','q"v','tail\\','& echo NOT_A_COMMAND','$(not a command)','中文参数'];
  const result=await worker.run({...basic,arguments:['-e','process.stdout.write(JSON.stringify(process.argv.slice(1)))',...values]});
  assert.deepEqual(JSON.parse(result.stdout.toString('utf8')),values);assert.equal(result.memoryLimitBytes,basic.memoryBytes);assert.ok(result.peakCommitBytes>0);assert.ok(result.peakCommitBytes<=basic.memoryBytes);
  assert.deepEqual(await readdir(directory),[]);
});

test('bounded worker timeout, output overflow and cancellation recover their temporary files',async()=>{
  const directory=await root(),worker=new BoundedProcess(directory);
  await assert.rejects(worker.run({...basic,arguments:['-e','setInterval(()=>{},1000)'],timeoutMs:100}),/MEDIA_WORKER_TIMEOUT/);
  await assert.rejects(worker.run({...basic,arguments:['-e','process.stdout.write("x".repeat(100000))'],maxStdoutBytes:32}),/MEDIA_WORKER_OUTPUT_LIMIT/);
  for(const delay of [20,100,200,350]){
    const abort=new AbortController(),pending=worker.run({...basic,arguments:['-e','setInterval(()=>{},1000)'],signal:abort.signal});setTimeout(()=>abort.abort(),delay);
    await assert.rejects(pending,/MEDIA_CANCELLED|AbortError/);assert.deepEqual(await readdir(directory),[]);
  }
});

test('a native allocation beyond the configured committed-memory ceiling cannot finish successfully',async()=>{
  const directory=await root(),worker=new BoundedProcess(directory);
  await assert.rejects(worker.run({...basic,memoryBytes:64*1024*1024,arguments:['-e','const data=Buffer.alloc(256*1024*1024,1);process.stdout.write(String(data.length));']}),/MEDIA_WORKER_FAILED/);
  assert.deepEqual(await readdir(directory),[]);
});

test('compiler cleanup refuses the workspace root and outside paths without changing their files',async()=>{
  const directory=await root(),outside=await root(),sentinel=join(outside,'keep.txt');await writeFile(sentinel,'synthetic-protected-file');
  const powershell=join(process.env.SystemRoot??'C:\\Windows','System32/WindowsPowerShell/v1.0/powershell.exe');
  const run=(target:string)=>promisify(execFile)(powershell,['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',resolve('packages/media/workers/restore-compiler-temp-access.ps1'),'-WorkRoot',directory,'-Directory',target],{windowsHide:true,timeout:10000});
  for(const target of [directory,outside])await assert.rejects(run(target));
  const valid=join(directory,'process-fixture');await mkdir(valid);await run(valid);
  assert.equal(await readFile(sentinel,'utf8'),'synthetic-protected-file');assert.deepEqual(await readdir(directory),['process-fixture']);
});
