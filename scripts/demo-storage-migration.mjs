import { readFile,writeFile,mkdir } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { migrationFixture } from '../build-tests/runtime-migration-fixture.js';
import { legacySnapshot } from '../build-tests/legacy-memory-fixture.js';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { randomUUID } from 'node:crypto';

const stage=process.argv[2]??'current';if(!['current','1E-1','1E-3'].includes(stage))throw new Error('Unknown migration demo stage');
const reportName=stage==='1E-1'?'phase1e1-storage.json':stage==='1E-3'?'phase1e3-storage.json':'storage-migration-current.json';

const demoRoot=resolve('.runtime/demos','migration-'+randomUUID());await mkdir(demoRoot,{recursive:true});
const fixture=await migrationFixture(demoRoot),file=join(fixture.memoryDir,'memory.sqlite');
const beforeDb=new DatabaseSync(file,{readOnly:true});const before=runtimeHash(legacySnapshot(beforeDb));beforeDb.close();
const configFile=join(fixture.root,'host-fixture.json'),planFile=join(fixture.root,'migration-plan.json');
await writeFile(join(fixture.root,'persona.test.md'),'这是虚构的迁移验收人格。\n');
await writeFile(configFile,JSON.stringify({schemaVersion:1,profileId:fixture.identity.profileId,agent:{id:'fish'},paths:{core:'./core',memory:'./memory',sessions:'./sessions',query:'./query.sqlite'},
  modelRoutes:{chat:{provider:'local-test',model:'scripted'}},plugins:[],persona:{fixedFile:'./persona.test.md',kind:'test'}},null,2));
const run=args=>JSON.parse(execFileSync(process.execPath,['scripts/migrate-profile.mjs',...args],{cwd:process.cwd(),encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim());
const planned=run(['plan','--config',configFile,'--backup-dir',fixture.backupDir,'--out',planFile]);
const applied=run(['apply','--config',configFile,'--plan',planFile]);
const verified=run(['verify','--plan',planFile]);
const repeated=run(['apply','--config',configFile,'--plan',planFile]);
const afterDb=new DatabaseSync(file,{readOnly:true});const after=runtimeHash(legacySnapshot(afterDb));afterDb.close();
const plan=JSON.parse(await readFile(planFile,'utf8'));
const report={stage,kind:'real-sqlite-fictional-data-no-model',at:new Date().toISOString(),serverAccess:false,realRuntimeData:false,
  checks:{cliPlan:planned.status==='planned',cliApply:applied.complete===true,cliVerify:verified.passed===true,idempotentApply:repeated.complete===true,legacyRowsUnchanged:before===after},
  engineHash:plan.engineHash,sourceRevision:plan.bundle.provenance.sourceRevision,sourceWorktreeDirty:plan.bundle.provenance.dirty,
  configHash:plan.bundle.provenance.configHash,stores:verified.stores.map(({kind,version,supported,integrity,identityMatches})=>({kind,version,supported,integrity,identityMatches})),
  legacyBeforeHash:before,legacyAfterHash:after,sessionFixture:'synthetic JSONL bytes; no model or DSH replay triggered'};
report.passed=Object.values(report.checks).every(Boolean);
await writeFile(join(fixture.root,'report.json'),JSON.stringify(report,null,2)+'\n');
await mkdir(resolve('docs/results'),{recursive:true});await writeFile(resolve('docs/results',reportName),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report));if(!report.passed)process.exitCode=1;
