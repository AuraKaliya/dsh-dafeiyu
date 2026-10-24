import { readFileSync,realpathSync,statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import type { PersonaSnapshot } from '@dafeiyu/contracts';

export interface FoundationSnapshot extends PersonaSnapshot {readonly fileIdentity:string}
/** A fixed UTF-8 foundation per Run. No fallback to a test persona or a mutable history summary. */
export function readFoundation(file:string):FoundationSnapshot {
  try{
    const path=realpathSync(file),stat=statSync(path);
    if(!stat.isFile()||stat.size>128003)throw new Error('FOUNDATION_INVALID');
    const text=new TextDecoder('utf-8',{fatal:true}).decode(readFileSync(path)).trim();
    if(!text||text.length>32000||text.includes('\0'))throw new Error('FOUNDATION_INVALID');
    const identity=process.platform==='win32'?path.toLowerCase():path;
    return Object.freeze({text,version:createHash('sha256').update(text).digest('hex'),fileIdentity:createHash('sha256').update(identity).digest('hex')});
  }catch{throw new Error('FOUNDATION_INVALID');}
}
