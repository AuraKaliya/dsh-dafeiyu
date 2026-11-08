import {mkdirSync,existsSync,copyFileSync,readdirSync} from 'node:fs';
import {resolve,join,relative} from 'node:path';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {readJson,saveJson,repository,fingerprint,hash} from './io.mjs';
import {fileHash,fileInventory,inventoryHash,inspectReleaseIntegrity,inspectInstalledDependencies} from '../release-integrity.mjs';
import {auditDirectory} from './audit.ts';
import {catalog} from './catalog.ts';
import {auditLocalCandidate} from './candidate-audit.ts';
import {prepareCalibration} from './prepare-calibration.ts';

const optionsSchema=z.strictObject({release:z.string(),regression:z.string(),smoke:z.string(),business:z.string(),performance:z.string(),fresh:z.string(),upgrade:z.string(),calibration:z.string(),output:z.string()});
const inside=(root:string,path:string)=>{const rest=relative(root,path);if(!rest||rest.startsWith('..')||rest.includes(':'))throw new Error('CANDIDATE_PATH_OUTSIDE_ROOT');return path;};
function verifyRollbackEvidence(raw:unknown){
  const inventory=z.array(z.object({path:z.string(),bytes:z.number(),sha256:z.string()})).min(1);
  const upgrade=z.object({from:z.object({directory:z.string(),contentHash:z.string(),lockHash:z.string(),dependencyHash:z.string()}),backupDirectory:z.string(),backupFiles:inventory,afterUpgradeDirectory:z.string(),afterUpgradeFiles:inventory,rollbackDirectory:z.string(),rollbackFiles:inventory}).parse(raw);
  const old=inspectReleaseIntegrity(upgrade.from.directory),dependencies=inspectInstalledDependencies(upgrade.from.directory);
  if(old.contentHash!==upgrade.from.contentHash||dependencies.lockHash!==upgrade.from.lockHash||dependencies.contentHash!==upgrade.from.dependencyHash)throw new Error('CANDIDATE_ROLLBACK_PROGRAM_CHANGED');
  for(const [directory,expected]of [[upgrade.backupDirectory,upgrade.backupFiles],[upgrade.afterUpgradeDirectory,upgrade.afterUpgradeFiles],[upgrade.rollbackDirectory,upgrade.rollbackFiles]] as const){
    if(hash(fileInventory(directory))!==hash(expected))throw new Error('CANDIDATE_BACKUP_CHANGED');
  }
}
export function verifyCandidate(file:string){const seal=z.object({release:z.object({directory:z.string(),contentHash:z.string(),manifestHash:z.string()}),dependencies:z.object({lockHash:z.string(),contentHash:z.string()}),evidenceHash:z.string(),audit:z.object({localReady:z.boolean(),releaseAccepted:z.literal(false)})}).parse(readJson(file));
  const root=resolve(file,'..'),release=inspectReleaseIntegrity(seal.release.directory),dependencies=inspectInstalledDependencies(seal.release.directory);
  if(release.contentHash!==seal.release.contentHash||fileHash(join(seal.release.directory,'release.json'))!==seal.release.manifestHash||dependencies.lockHash!==seal.dependencies.lockHash||dependencies.contentHash!==seal.dependencies.contentHash||inventoryHash(fileInventory(join(root,'evidence')))!==seal.evidenceHash)throw new Error('CANDIDATE_CHANGED');
  verifyRollbackEvidence(readJson(join(root,'evidence/upgrade.json')));
  return {unchanged:true,localReady:seal.audit.localReady,releaseAccepted:false};
}
export async function sealCandidate(input:unknown){const options=optionsSchema.parse(input),releaseDir=resolve(options.release),output=resolve(options.output);
  if(existsSync(output))throw new Error('CANDIDATE_NEW_DIRECTORY_REQUIRED');if(!relative(releaseDir,output).startsWith('..'))throw new Error('CANDIDATE_OUTPUT_INSIDE_RELEASE');
  const release=inspectReleaseIntegrity(releaseDir),dependencies=inspectInstalledDependencies(releaseDir);
  if(release.release.sourceHash!==fingerprint('source')||release.release.driverHash!==fingerprint('driver')||release.release.buildRuntimeHash!==fingerprint('runtime'))throw new Error('CANDIDATE_WORKSPACE_CHANGED');
  const module=await import(pathToFileURL(join(releaseDir,'runtime/contracts/lib/protocol.js')).href);if(module.RELEASE_VERSION!==release.version)throw new Error('CANDIDATE_LOADED_VERSION_MISMATCH');
  const business=auditDirectory(resolve(options.business)),fresh=z.object({packageRoot:z.string(),dependencyIdentity:z.object({lockHash:z.string(),contentHash:z.string()})}).parse(readJson(resolve(options.fresh)));
  if(resolve(fresh.packageRoot)!==releaseDir||fresh.dependencyIdentity.lockHash!==dependencies.lockHash||fresh.dependencyIdentity.contentHash!==dependencies.contentHash)throw new Error('CANDIDATE_INSTALL_EVIDENCE_MISMATCH');
  verifyRollbackEvidence(readJson(resolve(options.upgrade)));
  const performance=z.record(z.string(),z.unknown()).parse(readJson(join(options.performance,'audit.json')));
  for(const [key,file]of [['heavy','heavy'],['cancel','cancellation'],['recovery','recovery']] as const)if(hash(performance[key])!==hash(readJson(join(options.performance,file+'.json'))))throw new Error('CANDIDATE_PERFORMANCE_EVIDENCE_MISMATCH');
  if(hash(performance.baseline)!==hash(readJson(join(repository,'tests/fixtures/acceptance/heavy-baseline.json'))))throw new Error('CANDIDATE_PERFORMANCE_BASELINE_MISMATCH');
  const calibration=prepareCalibration(readJson(join(repository,'tests/fixtures/acceptance/verifier-cases.json')));
  for(const [name,expected]of Object.entries(calibration))if(hash(readJson(join(options.calibration,name+'.json')))!==hash(expected))throw new Error('CANDIDATE_CALIBRATION_CHANGED');
  const testFiles=(directory:string)=>readdirSync(join(repository,directory)).filter(file=>file.endsWith('.test.ts')).map(file=>directory+'/'+file);
  const audit=auditLocalCandidate({version:release.version,contentHash:release.contentHash,sourceHash:release.release.sourceHash!,driverHash:release.release.driverHash!,runtimeHash:release.release.buildRuntimeHash!,unitFiles:[...testFiles('tests'),...testFiles('tests/tooling')],smokeFiles:testFiles('tests/smoke')},{
    regression:readJson(resolve(options.regression)),smoke:readJson(resolve(options.smoke)),business:{...business,manifest:readJson(join(options.business,'manifest.json')),completion:readJson(join(options.business,'completion.json'))},performance:{...performance,manifest:readJson(join(options.performance,'manifest.json'))},fresh:readJson(resolve(options.fresh)),upgrade:readJson(resolve(options.upgrade)),calibration:{manifest:readJson(join(options.calibration,'manifest.json')),readiness:readJson(join(options.calibration,'readiness.json')),observations:readJson(join(options.calibration,'observations.json'))}});
  if(!audit.localReady)throw new Error('CANDIDATE_LOCAL_CHECKS_FAILED',{cause:audit});
  mkdirSync(join(output,'evidence'),{recursive:true});const copy=(source:string,name:string)=>{const target=inside(output,join(output,'evidence',name));mkdirSync(resolve(target,'..'),{recursive:true});copyFileSync(source,target);};
  for(const name of ['regression','smoke','fresh','upgrade'] as const)copy(resolve(options[name]),name+'.json');
  for(const name of ['manifest','configuration','completion','audit','baseline',...catalog.map(row=>row.id)])copy(join(options.business,name+'.json'),'business/'+name+'.json');
  for(const name of ['manifest','audit','heavy','cancellation','recovery'])copy(join(options.performance,name+'.json'),'performance/'+name+'.json');
  copy(join(options.performance,'heavy.cpuprofile'),'performance/heavy.cpuprofile');
  for(const name of ['manifest','inputs','expectations','observations','readiness'])copy(join(options.calibration,name+'.json'),'calibration/'+name+'.json');
  saveJson(join(output,'evidence','live-requirements.json'),{state:'not-executed',program:{version:release.version,contentHash:release.contentHash},model:null,configurationHash:null,realSemanticRun:null,minimumContinuousMs:7200000,processIdentity:null,lateBusinessReceipt:null,costEvidence:null,authorization:{paidTests:false,realOutbound:false,deployment:false},note:'不得用本地脚本样本或历史运行填充真实观察。配置与模型须在获授权后重新核对并冻结。'});
  const seal={schemaVersion:1,kind:'dafeiyu-local-candidate',candidateId:randomUUID(),createdAt:new Date().toISOString(),version:release.version,apiVersion:module.API_VERSION,release:{directory:releaseDir,...release,manifestHash:fileHash(join(releaseDir,'release.json'))},dependencies,evidenceHash:inventoryHash(fileInventory(join(output,'evidence'))),audit};
  saveJson(join(output,'candidate.json'),seal);return {file:join(output,'candidate.json'),...verifyCandidate(join(output,'candidate.json'))};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){const [mode,file,...extra]=process.argv.slice(2);if(extra.length||!file||!['seal','verify'].includes(mode!))throw new Error('Usage: seal-candidate.ts seal <evidence-index.json> | verify <candidate.json>');
  console.log(JSON.stringify(mode==='seal'?await sealCandidate(readJson(resolve(file))):verifyCandidate(resolve(file))));}
