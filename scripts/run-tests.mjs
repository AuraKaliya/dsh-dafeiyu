import { spawn, execFile } from 'node:child_process';
import { mkdir, readFile, writeFile, readdir, stat } from 'node:fs/promises';
import { join, resolve, basename } from 'node:path';
import { TestStorage, childEnvironment, budgetCheck, repository } from './testing/workspace.ts';
import { freeBytes, removeTree } from './testing/files.ts';

const storage = new TestStorage();
const unlock = await storage.lock();
let run, child, stopped = null, monitoring = false, timer;
const stages = [];
const stop = reason => {
  stopped ??= reason;
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === 'win32') execFile('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }, () => {});
  else child.kill('SIGTERM');
};
process.once('SIGINT', () => stop('TEST_INTERRUPTED'));
process.once('SIGTERM', () => stop('TEST_INTERRUPTED'));
try {
  const prior = await storage.sweep();
  if (prior.blocked.length) throw new Error('TEST_CLEANUP_REQUIRED');
  run = await storage.create();
  const initialBudget = await budgetCheck(run); if (initialBudget) throw new Error(initialBudget);
  const env = childEnvironment(run);
  const execute = async (name, args) => {
    if (stopped) throw new Error(stopped);
    const started = Date.now();
    const exit = await new Promise((done, reject) => {
      child = spawn(process.execPath, args, { cwd: repository, env, windowsHide: true, stdio: ['ignore', 'inherit', 'inherit'] });
      child.once('error', reject); child.once('close', (code, signal) => { child = undefined; done({ code, signal }); });
    });
    stages.push({ name, ...exit, durationMs: Date.now() - started });
    if (exit.code !== 0) throw new Error(stopped ?? 'TEST_STAGE_FAILED');
  };
  timer = setInterval(async () => {
    if (monitoring || stopped) return; monitoring = true;
    try { const reason = await budgetCheck(run); if (reason) stop(reason); } catch { stop('TEST_STORAGE_MONITOR_FAILED'); }
    finally { monitoring = false; }
  }, 2000);
  const available = [...(await readdir(join(repository, 'tests'))).filter(name => name.endsWith('.test.ts')).map(name => 'build-tests/' + name.replace(/\.ts$/,'.js')),
    ...(await readdir(join(repository, 'tests', 'tooling'))).filter(name => name.endsWith('.test.ts')).map(name => 'tests/tooling/' + name)].sort();
  const requested = process.argv.slice(2), files = requested.length ? requested : available;
  if (!files.length || files.some(file => !available.includes(file))) throw new Error('TEST_FILE_NOT_ALLOWED');
  await execute('build', ['node_modules/typescript/bin/tsc', '-b']);
  if(requested.length){
    const sources=files.filter(file=>file.startsWith('build-tests/')).map(file=>resolve(repository,'tests',basename(file).replace(/\.js$/,'.ts')));
    if(sources.length){const config=join(run.root,'test-types.json');
      await writeFile(config,JSON.stringify({extends:resolve(repository,'tests/tsconfig.json'),compilerOptions:{rootDir:resolve(repository,'tests'),outDir:resolve(repository,'build-tests')},include:[],files:sources}));
      await execute('test-types',['node_modules/typescript/bin/tsc','-p',config]);}
  }else await execute('test-types', ['node_modules/typescript/bin/tsc', '-p', 'tests/tsconfig.json']);
  if(requested.length){
    const config=join(run.root,'tooling-types.json');
    const tooling=(await readdir(join(repository,'scripts/testing'))).filter(name=>name.endsWith('.ts')).map(name=>resolve(repository,'scripts/testing',name));
    await writeFile(config,JSON.stringify({extends:resolve(repository,'scripts/testing/tsconfig.json'),include:[],files:[...tooling,...files.filter(file=>file.startsWith('tests/tooling/')).map(file=>resolve(repository,file))]}));
    await execute('tooling-types',['node_modules/typescript/bin/tsc','-p',config]);
  }else await execute('tooling-types', ['node_modules/typescript/bin/tsc', '-p', 'scripts/testing/tsconfig.json']);
  await execute('tests', ['scripts/testing/driver.ts', ...files]);
  const summary = JSON.parse(await readFile(join(run.root, 'summary.json'), 'utf8'));
  if (!summary.success || summary.counts.tests < 1) throw new Error('TEST_SUMMARY_FAILED');
} catch (error) {
  stopped ??= error instanceof Error && /^[A-Z_]+$/.test(error.message) ? error.message : 'TEST_RUN_FAILED';
  process.exitCode = 1;
} finally {
  if (timer) clearInterval(timer);
  while (monitoring) await new Promise(done => setTimeout(done, 20));
  if (run) {
    let summary = null; try { summary = JSON.parse(await readFile(join(run.root, 'summary.json'), 'utf8')); } catch { /* A build failure has no test summary. */ }
    const cleanup = await storage.finish(run, stopped ? stopped === 'TEST_INTERRUPTED' ? 'interrupted' : 'failed' : 'passed', stopped);
    if (cleanup.blocked.length) process.exitCode = 1;
    const report = { schemaVersion: 1, runId: run.id, startedAt: run.createdAt, finishedAt: new Date().toISOString(), stages, summary,
      reason: stopped, cleanup, freeBytes: await freeBytes(storage.root), realModel: false, realPlatform: false, serverAccess: false };
    const reports = join(repository, '.runtime', 'test-reports'); await mkdir(reports, { recursive: true });
    await writeFile(join(reports, run.id + '.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    // Only bounded, metadata-only runner reports; formal acceptance reports live elsewhere.
    const old = await Promise.all((await readdir(reports)).filter(name => /^[a-f0-9-]{36}\.json$/.test(name)).map(async name => ({ name, time: (await stat(join(reports, name))).mtimeMs })));
    for (const entry of old.sort((a, b) => b.time - a.time).slice(20)) await removeTree(join(reports, entry.name), reports);
    console.log(JSON.stringify({ runId: run.id, passed: !stopped && !cleanup.blocked.length, tests: summary?.counts ?? null, cleanup, report: join(reports, run.id + '.json') }));
  } else console.error(stopped ?? 'TEST_RUN_FAILED');
  await unlock();
}
