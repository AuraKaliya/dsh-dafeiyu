import { mkdir,readFile,writeFile,lstat,realpath } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve,join,relative,isAbsolute,dirname,sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { EvaluationLedger,EvaluationConfigSchema } from './ledger.ts';
import type { EvaluationConfig } from './ledger.ts';
import { EvaluationCatalog,sha256 } from './catalog.ts';
import { RuntimeIdentitySchema,runtimeIdentityHash } from './identity.ts';
import type { RuntimeIdentity } from './identity.ts';

const markerSchema=z.strictObject({kind:z.literal('dafeiyu-evaluation-workspace-v1'),id:z.uuid(),root:z.string(),configHash:z.string().length(64),createdAt:z.iso.datetime(),temporary:z.boolean()});
const inside=(path:string,root:string)=>{const delta=relative(root,path);return delta!==''&&!delta.startsWith('..'+sep)&&delta!=='..'&&!isAbsolute(delta);};
function namespace(repository:string,path:string){const formal=resolve(repository,'.runtime/acceptance'),temporary=process.env.DAFEIYU_TEST_RUN?resolve(process.env.DAFEIYU_TEST_RUN):null;if(!/^[dD]:[\\/]/.test(path))throw new Error('EVALUATION_D_DRIVE_REQUIRED');if(temporary&&inside(path,temporary))return {root:temporary,temporary:true};if(inside(path,formal))return {root:formal,temporary:false};throw new Error('EVALUATION_WORKSPACE_OUTSIDE_NAMESPACE');}
async function safeDirectory(path:string,base:string,create=false){if(path!==base&&!inside(path,base))throw new Error('EVALUATION_PATH_DENIED');const parts=relative(base,path).split(sep).filter(Boolean);let current=base;
  for(const part of ['',...parts]){if(part)current=join(current,part);if(existsSync(current)){const info=await lstat(current);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');}else{if(!create)throw new Error('EVALUATION_DIRECTORY_MISSING');await mkdir(current);}}
  const actual=await realpath(path),actualBase=await realpath(base);if(actual!==actualBase&&!inside(actual,actualBase))throw new Error('EVALUATION_PATH_DENIED');}
function artifactPath(root:string,relativePath:string){if(!/^[a-zA-Z0-9._/-]{1,300}$/.test(relativePath)||relativePath.split('/').some(p=>['','.','..'].includes(p)))throw new Error('EVALUATION_PATH_DENIED');const file=resolve(root,...relativePath.split('/'));if(!inside(file,root))throw new Error('EVALUATION_PATH_DENIED');return file;}
async function readArtifact(root:string,relativePath:string){const file=artifactPath(root,relativePath);await safeDirectory(dirname(file),root);const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size>4*1024**2)throw new Error('EVALUATION_ARTIFACT_INVALID');return readFile(file);}
/** Append-only formal artifacts. No cleanup command is exposed here. */
export class EvaluationWorkspace {
  readonly root:string;readonly ledger:EvaluationLedger;
  private constructor(root:string,ledger:EvaluationLedger){this.root=root;this.ledger=ledger;}
  static async create(repository:string,path:string,catalog:EvaluationCatalog,revision:string,runtime?:RuntimeIdentity){const root=resolve(path),space=namespace(repository,root);if(existsSync(root))throw new Error('EVALUATION_WORKSPACE_EXISTS');
    if(!existsSync(space.root)){if(space.temporary)throw new Error('EVALUATION_DIRECTORY_MISSING');await safeDirectory(space.root,resolve(repository),true);}
    await safeDirectory(dirname(root),space.root,true);await mkdir(root);const config=EvaluationConfigSchema.parse({schemaVersion:1,suiteId:catalog.suite.suiteId,suiteHash:catalog.suiteHash,manifestHash:catalog.manifestHash,foundationHash:catalog.foundationHash,codeRevision:revision,...(runtime?{runtimeHash:runtimeIdentityHash(runtime)}:{}),mode:'offline',
      budget:{authorized:false,maximumMicroCny:0,expiresAt:'9999-12-31T23:59:59.999Z',pricingHash:sha256('offline-no-billing'),inputMicroCnyPerMillion:0,outputMicroCnyPerMillion:0},cases:catalog.manifest.cases.map(({id,reviewId})=>({id,reviewId}))});
    const marker=markerSchema.parse({kind:'dafeiyu-evaluation-workspace-v1',id:randomUUID(),root,configHash:sha256(JSON.stringify(config)),createdAt:new Date().toISOString(),temporary:space.temporary});
    await writeFile(join(root,'workspace.json'),JSON.stringify(marker,null,2)+'\n',{flag:'wx'});await writeFile(join(root,'config.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
    const ledger=new EvaluationLedger(join(root,'evaluation.sqlite'),config,true),workspace=new EvaluationWorkspace(root,ledger);
    try{for(const [file,text] of Object.entries(catalog.sourceFiles))await workspace.write(file,text);if(runtime)await workspace.write('runtime-identity.json',JSON.stringify(RuntimeIdentitySchema.parse(runtime),null,2)+'\n');await workspace.write('prepared.json',JSON.stringify({id:marker.id,configHash:marker.configHash,sources:catalog.summary()},null,2)+'\n');return workspace;}catch(e){ledger.close();throw e;}}
  static async open(repository:string,path:string){const root=resolve(path),space=namespace(repository,root);await safeDirectory(root,space.root);const marker=markerSchema.parse(JSON.parse((await readArtifact(root,'workspace.json')).toString())),config=EvaluationConfigSchema.parse(JSON.parse((await readArtifact(root,'config.json')).toString())),prepared=z.object({id:z.uuid(),configHash:z.string()}).parse(JSON.parse((await readArtifact(root,'prepared.json')).toString()));
    if(marker.root!==root||marker.temporary!==space.temporary||prepared.id!==marker.id||prepared.configHash!==marker.configHash||marker.configHash!==sha256(JSON.stringify(config)))throw new Error('EVALUATION_WORKSPACE_CHANGED');
    for(const [file,expected] of [['sources/suite.v1.json',config.suiteHash],['sources/manifest.v1.json',config.manifestHash]] as const)if(sha256(await readArtifact(root,file))!==expected)throw new Error('EVALUATION_WORKSPACE_CHANGED');if(sha256((await readArtifact(root,'sources/persona.foundation.md')).toString().trim())!==config.foundationHash)throw new Error('EVALUATION_WORKSPACE_CHANGED');
    if(config.runtimeHash&&runtimeIdentityHash(RuntimeIdentitySchema.parse(JSON.parse((await readArtifact(root,'runtime-identity.json')).toString())))!==config.runtimeHash)throw new Error('EVALUATION_RUNTIME_CHANGED');
    const ledgerFile=await lstat(join(root,'evaluation.sqlite'));if(!ledgerFile.isFile()||ledgerFile.isSymbolicLink())throw new Error('EVALUATION_LINK_DENIED');
    return new EvaluationWorkspace(root,new EvaluationLedger(join(root,'evaluation.sqlite'),config));}
  async write(relativePath:string,content:string|Uint8Array){const file=artifactPath(this.root,relativePath),bytes=typeof content==='string'?Buffer.from(content):content;if(bytes.byteLength>4*1024**2)throw new Error('EVALUATION_ARTIFACT_TOO_LARGE');await safeDirectory(dirname(file),this.root,true);await writeFile(file,bytes,{flag:'wx'});return {relative:relativePath,hash:sha256(bytes)};}
  async read(relativePath:string,expectedHash:string){const bytes=await readArtifact(this.root,relativePath);if(sha256(bytes)!==expectedHash)throw new Error('EVALUATION_ARTIFACT_CHANGED');return bytes;}
  async exportReport(){return this.write('reports/'+randomUUID()+'.json',JSON.stringify(this.ledger.report(),null,2)+'\n');}
  get config():EvaluationConfig{return this.ledger.config;}
  close(){this.ledger.close();}
}
