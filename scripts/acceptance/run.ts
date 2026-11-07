import {mkdirSync, openSync, closeSync, existsSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {spawn, execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {catalog, criteriaVersion, offlineConfiguration} from './catalog.ts';
import {manifestSchema, completionSchema} from './schema.ts';
import {repository, fingerprint, readJson, saveJson, hash} from './io.mjs';
import {auditDirectory} from './audit.ts';
import {readFileSync} from 'node:fs';

const args=process.argv.slice(2);
if (args.length && (args.length!==2 || args[0]!=='--out' || !args[1])) throw new Error('Usage: node scripts/acceptance/run.ts [--out <new-directory>]');
const runId=randomUUID(),directory=resolve(args[1]??join(repository,'.runtime','acceptance',new Date().toISOString().replaceAll(':','-')+'-'+runId));
if (existsSync(directory)) throw new Error('ACCEPTANCE_NEW_DIRECTORY_REQUIRED');
mkdirSync(dirname(directory),{recursive:true});mkdirSync(directory);
const pkg=z.object({version:z.string()}).parse(readJson(join(repository,'package.json')));
const protocol=readFileSync(join(repository,'packages/contracts/src/protocol.ts'),'utf8');
const apiVersion=Number(/API_VERSION\s*=\s*(\d+)/.exec(protocol)?.[1]);
let revision:string|null=null;
try{const options={cwd:repository,encoding:'utf8' as const,windowsHide:true,stdio:['ignore','pipe','ignore'] as ['ignore','pipe','ignore']};
  if(resolve(execFileSync('git',['rev-parse','--show-toplevel'],options).trim())===repository)revision=execFileSync('git',['rev-parse','HEAD'],options).trim();
}catch{/* Source archives have content identities without inventing a Git revision. */}
const manifest=manifestSchema.parse({schemaVersion:1,runId,mode:'offline-sdk',criteriaVersion,
  revision,version:pkg.version,apiVersion,
  sourceHash:fingerprint('source'),driverHash:fingerprint('driver'),configHash:hash(offlineConfiguration),catalogHash:hash(catalog),
  startedAt:new Date().toISOString(),scenarios:catalog.map(row=>row.id)});
saveJson(join(directory,'manifest.json'),manifest);
saveJson(join(directory,'configuration.json'),offlineConfiguration);
const log=openSync(join(directory,'tests.log'),'wx');
console.log(JSON.stringify({runId,mode:'offline-sdk',directory,scenarios:manifest.scenarios}));
let exitCode=-1;
try {
  exitCode=await new Promise<number>((done,reject)=>{
    const child=spawn(process.execPath,['scripts/run-tests.mjs',...new Set(catalog.map(row=>row.file))],{
      cwd:repository,windowsHide:true,stdio:['ignore',log,log],
      env:{...process.env,DAFEIYU_ACCEPTANCE_DIR:directory,DAFEIYU_ACCEPTANCE_RUN:runId},
    });
    child.once('error',reject);child.once('close',code=>done(code??-1));
  });
} finally {closeSync(log);}
const artifactHashes:Record<string,string>={};
for (const spec of catalog) if (existsSync(join(directory,spec.id+'.json'))) artifactHashes[spec.id]=hash(readJson(join(directory,spec.id+'.json')));
const completion=completionSchema.parse({schemaVersion:1,runId,finishedAt:new Date().toISOString(),testExitCode:exitCode,
  sourceHash:fingerprint('source'),driverHash:fingerprint('driver'),runtimeHash:fingerprint('runtime'),artifactHashes});
saveJson(join(directory,'completion.json'),completion);
const audit=auditDirectory(directory);
saveJson(join(directory,'audit.json'),audit);
saveJson(join(directory,'baseline.json'),{schemaVersion:1,runId,configHash:manifest.configHash,sourceHash:manifest.sourceHash,
  comparableGoals:catalog.map(row=>({scenario:row.id,requirements:row.requirements})),
  scenarios:audit.scenarios.map(row=>({id:row.id,measurement:row.baseline})),realUsageMeasured:false});
console.log(JSON.stringify({runId,passed:audit.passed,releaseAccepted:false,report:join(directory,'audit.json'),testsLog:join(directory,'tests.log')}));
if (!audit.passed) process.exitCode=1;
