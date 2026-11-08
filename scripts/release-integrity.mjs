import {readFileSync,readdirSync,lstatSync,realpathSync,existsSync} from 'node:fs';
import {join,relative,resolve,dirname,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
export const fileHash=file=>digest(readFileSync(file));
const json=file=>JSON.parse(readFileSync(file,'utf8'));
const portable=path=>path.split(sep).join('/');
export function fileInventory(root,{payload=false}={}){
  root=resolve(root);if(lstatSync(root).isSymbolicLink())throw new Error('RELEASE_LINK_REFUSED');
  const walk=directory=>readdirSync(directory,{withFileTypes:true}).flatMap(entry=>{
    const file=join(directory,entry.name),path=portable(relative(root,file));
    if(payload&&['node_modules','package-lock.json','release.json'].includes(path))return [];
    const stat=lstatSync(file);if(stat.isSymbolicLink())throw new Error('RELEASE_LINK_REFUSED');
    return stat.isDirectory()?walk(file):[{path,bytes:stat.size,sha256:fileHash(file)}];
  });return walk(root).sort((a,b)=>a.path.localeCompare(b.path));
}
/** Same path/content representation used by build-public-release, excluding its self-referential manifest. */
export const inventoryHash=inventory=>digest(JSON.stringify(inventory.map(row=>[row.path,row.sha256])));
export function inspectReleaseIntegrity(root){const pkg=json(join(root,'package.json')),release=json(join(root,'release.json')),inventory=fileInventory(root,{payload:true}),actual=inventoryHash(inventory);
  if(pkg.name!=='dsh-dafeiyu'||pkg.version!==release.version)throw new Error('RELEASE_VERSION_MISMATCH');
  if(release.contentHash!==actual)throw new Error('RELEASE_CONTENT_MISMATCH');
  return {version:pkg.version,release,contentHash:actual,files:inventory.length,bytes:inventory.reduce((sum,row)=>sum+row.bytes,0)};
}
export function inspectInstalledDependencies(root){root=realpathSync(resolve(root));const pkg=json(join(root,'package.json')),lock=json(join(root,'package-lock.json')),require=createRequire(join(root,'package.json'));
  const specs=value=>JSON.stringify(Object.entries(value??{}).sort(([a],[b])=>a.localeCompare(b)));
  if(lock.name!==pkg.name||lock.version!==pkg.version||specs(lock.packages?.['']?.dependencies)!==specs(pkg.dependencies))throw new Error('RELEASE_LOCK_MISMATCH');
  const inventory=fileInventory(join(root,'node_modules')),dependencies=Object.entries(pkg.dependencies??{}).map(([name,specifier])=>{
    const entry=realpathSync(require.resolve(name)),inside=relative(root,entry);if(inside.startsWith('..')||inside.includes(':'))throw new Error('RELEASE_DEPENDENCY_OUTSIDE_PACKAGE');
    let folder=dirname(entry);while(!existsSync(join(folder,'package.json'))){const parent=dirname(folder);if(parent===folder||relative(root,parent).startsWith('..'))throw new Error('RELEASE_DEPENDENCY_MANIFEST_MISSING');folder=parent;}
    const module=json(join(folder,'package.json')),path=portable(relative(root,folder));if(module.name!==name||module.version!==lock.packages?.[path]?.version||module.version!==specifier)throw new Error('RELEASE_DEPENDENCY_LOCK_MISMATCH');
    return {name,specifier,version:module.version,path,entry:portable(inside)};
  });return {lockHash:fileHash(join(root,'package-lock.json')),contentHash:inventoryHash(inventory),files:inventory.length,dependencies};
}
