import { execFileSync } from 'node:child_process';
import { createReadStream,existsSync } from 'node:fs';
import { readdir,lstat,realpath } from 'node:fs/promises';
import { join,relative,sep,resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { sha256 } from './catalog.ts';

export const RuntimeIdentitySchema=z.strictObject({schemaVersion:z.literal(1),node:z.string(),sqlite:z.string(),platform:z.string(),arch:z.string(),scope:z.literal('offline-evaluation-runtime-v1'),files:z.array(z.strictObject({path:z.string(),bytes:z.number().int().nonnegative(),hash:z.string().length(64)})),workspaceLinks:z.array(z.strictObject({path:z.string(),target:z.string()}))});
export type RuntimeIdentity=z.infer<typeof RuntimeIdentitySchema>;
export function cleanEvaluationRevision(repository:string){
  const paths=['packages','scripts','profiles','evaluation','package.json','package-lock.json',':(glob)tsconfig*.json'];
  const status=execFileSync('git',['status','--porcelain=v1','--untracked-files=all','--',...paths],{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','ignore']});
  if(status.trim())throw new Error('EVALUATION_CODE_NOT_COMMITTED');
  return execFileSync('git',['rev-parse','HEAD'],{cwd:repository,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();
}
/** Records the actual built code and installed runtime dependencies, not only the lockfile. */
export async function captureRuntimeIdentity(repository:string):Promise<RuntimeIdentity>{
  const root=resolve(repository),files:RuntimeIdentity['files']=[],workspaceLinks:RuntimeIdentity['workspaceLinks']=[];let total=0;
  const local=(path:string)=>relative(root,path).split(sep).join('/');
  async function walk(path:string):Promise<void>{
    const info=await lstat(path);if(info.isSymbolicLink())throw new Error('EVALUATION_RUNTIME_LINK_DENIED');
    if(info.isDirectory()){for(const entry of await readdir(path))await walk(join(path,entry));return;}
    if(!info.isFile())throw new Error('EVALUATION_RUNTIME_FILE_INVALID');
    total+=info.size;if(info.size>128*1024**2||total>512*1024**2||files.length>=30000)throw new Error('EVALUATION_RUNTIME_SIZE_LIMIT');
    const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);
    files.push({path:local(path),bytes:info.size,hash:hash.digest('hex')});
  }
  for(const path of ['package.json','package-lock.json','scripts/evaluation','scripts/prepare-integrated-acceptance.mjs','scripts/run-integrated-offline.mjs'])await walk(join(root,path));
  for(const entry of await readdir(root))if(/^tsconfig.*\.json$/.test(entry))await walk(join(root,entry));
  for(const entry of await readdir(join(root,'packages'),{withFileTypes:true})){
    if(!entry.isDirectory()||entry.isSymbolicLink())throw new Error('EVALUATION_RUNTIME_LINK_DENIED');
    const lib=join(root,'packages',entry.name,'lib');if(!existsSync(lib))throw new Error('EVALUATION_BUILD_MISSING');await walk(lib);
  }
  const excluded=new Set(['.bin','@dafeiyu','@types','typescript','undici-types']);
  for(const entry of await readdir(join(root,'node_modules'),{withFileTypes:true}))if(!excluded.has(entry.name))await walk(join(root,'node_modules',entry.name));
  await walk(join(root,'node_modules/typescript/package.json'));
  for(const entry of await readdir(join(root,'node_modules/@dafeiyu'))){
    const path=join(root,'node_modules/@dafeiyu',entry),expected=join(root,'packages',entry);
    if(await realpath(path)!==await realpath(expected))throw new Error('EVALUATION_RUNTIME_LINK_DENIED');workspaceLinks.push({path:local(path),target:local(expected)});
  }
  files.sort((a,b)=>a.path.localeCompare(b.path));workspaceLinks.sort((a,b)=>a.path.localeCompare(b.path));
  return RuntimeIdentitySchema.parse({schemaVersion:1,node:process.version,sqlite:process.versions.sqlite??'unknown',platform:process.platform,arch:process.arch,scope:'offline-evaluation-runtime-v1',files,workspaceLinks});
}
export const runtimeIdentityHash=(identity:RuntimeIdentity)=>sha256(JSON.stringify(RuntimeIdentitySchema.parse(identity)));
