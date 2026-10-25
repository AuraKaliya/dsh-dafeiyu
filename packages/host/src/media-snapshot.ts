import { createReadStream,existsSync } from 'node:fs';
import { readdir,lstat,realpath,stat,mkdir,copyFile } from 'node:fs/promises';
import { join,relative,resolve,isAbsolute,sep,dirname,basename } from 'node:path';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';

export const MediaFileSnapshotSchema=z.strictObject({relative:z.string().min(1).max(4000),bytes:z.number().int().nonnegative().safe(),hash:z.string().regex(/^[a-f0-9]{64}$/)});
export type MediaFileSnapshot=z.infer<typeof MediaFileSnapshotSchema>;
const within=(root:string,file:string)=>{const delta=relative(resolve(root),resolve(file));return !!delta&&delta!=='..'&&!delta.startsWith('..'+sep)&&!isAbsolute(delta);};
async function hash(file:string){const value=createHash('sha256');for await(const bytes of createReadStream(file))value.update(bytes);return value.digest('hex');}
export function mediaSnapshotPath(root:string,part:string){if(isAbsolute(part)||part.split(/[\\/]/).some(s=>s==='..'||s==='')||!/^media[\\/]objects[\\/][a-f0-9]{2}[\\/][a-f0-9]{64}$/.test(part)&&!/^media-analysis[\\/]/.test(part))throw new Error('MIGRATION_MEDIA_PATH_INVALID');
  const file=resolve(root,part);if(!within(root,file))throw new Error('MIGRATION_MEDIA_PATH_INVALID');return file;}
export async function mediaFilesSnapshot(coreDir:string):Promise<MediaFileSnapshot[]>{const result:MediaFileSnapshot[]=[];
  const visit=async(folder:string)=>{if((await lstat(folder)).isSymbolicLink())throw new Error('MIGRATION_MEDIA_LINK_UNSUPPORTED');for(const entry of await readdir(folder,{withFileTypes:true})){
    const file=join(folder,entry.name);if(entry.isSymbolicLink())throw new Error('MIGRATION_MEDIA_LINK_UNSUPPORTED');if(entry.isDirectory())await visit(file);else if(entry.isFile()){
      const part=relative(coreDir,file);mediaSnapshotPath(coreDir,part);if(!within(await realpath(coreDir),await realpath(file)))throw new Error('MIGRATION_MEDIA_PATH_INVALID');
      const before=await stat(file),digest=await hash(file),after=await stat(file);if(before.size!==after.size||before.mtimeMs!==after.mtimeMs)throw new Error('MIGRATION_MEDIA_CHANGED');
      if(part.startsWith('media'+sep+'objects')&&(basename(file)!==digest||basename(dirname(file))!==digest.slice(0,2)))throw new Error('MIGRATION_MEDIA_BLOB_CORRUPT');
      result.push({relative:part,bytes:before.size,hash:digest});if(result.length>100000)throw new Error('MIGRATION_MEDIA_COUNT_LIMIT');
    }else throw new Error('MIGRATION_MEDIA_FILE_UNSUPPORTED');}};
  for(const root of [join(coreDir,'media/objects'),join(coreDir,'media-analysis')])if(existsSync(root))await visit(root);
  const database=join(coreDir,'media.sqlite');if(existsSync(database)){const db=new DatabaseSync(database,{readOnly:true});try{for(const row of db.prepare('SELECT sha256,bytes FROM media_blobs WHERE present=1').all()){
    const found=result.find(entry=>entry.relative===join('media','objects',String(row.sha256).slice(0,2),String(row.sha256)));if(!found||found.bytes!==row.bytes)throw new Error('MIGRATION_MEDIA_BLOB_MISSING');}}finally{db.close();}}
  return result.sort((a,b)=>a.relative.localeCompare(b.relative));
}
export async function copyMediaSnapshot(coreDir:string,destination:string,files:readonly MediaFileSnapshot[]){for(const item of files){const source=mediaSnapshotPath(coreDir,item.relative),target=mediaSnapshotPath(destination,item.relative);
    await mkdir(dirname(target),{recursive:true});await copyFile(source,target);if((await stat(target)).size!==item.bytes||await hash(target)!==item.hash)throw new Error('MIGRATION_MEDIA_BACKUP_INVALID');}}
export async function verifyMediaBackup(destination:string,files:readonly MediaFileSnapshot[]){for(const item of files){const path=mediaSnapshotPath(destination,item.relative);if(!existsSync(path)||(await lstat(path)).isSymbolicLink()||(await stat(path)).size!==item.bytes||await hash(path)!==item.hash)throw new Error('MIGRATION_MEDIA_BACKUP_INVALID');}}
