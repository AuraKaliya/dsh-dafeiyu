import { createHash,randomUUID } from 'node:crypto';
import { mkdir,open,lstat,realpath,link,copyFile,unlink,rm,readdir } from 'node:fs/promises';
import { constants,createReadStream } from 'node:fs';
import { join,resolve } from 'node:path';
import { z } from 'zod';
import type { MediaAccess,MediaAssetRef,MediaAssetRecord,MediaByteStream,MediaCoverage } from '@dafeiyu/contracts';
import { MediaStore } from './store.js';
import type { StoredMediaSource } from './store.js';
import { contained } from './process.js';

export async function hashFile(file:string,maxBytes?:number){const hash=createHash('sha256');let bytes=0;for await(const chunk of createReadStream(file)){bytes+=chunk.length;if(maxBytes!==undefined&&bytes>maxBytes)throw new Error('MEDIA_SIZE_LIMIT');hash.update(chunk);}return {sha256:hash.digest('hex'),bytes};}
export async function nextWithAbort<T>(iterator:AsyncIterator<T>,signal:AbortSignal):Promise<IteratorResult<T>>{
  signal.throwIfAborted();
  return abortable(iterator.next(),signal);
}
export async function abortable<T>(pending:Promise<T>,signal:AbortSignal):Promise<T>{
  let abort!:()=>void;const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(new Error('MEDIA_CANCELLED'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
  try{return await Promise.race([pending,cancelled]);}finally{signal.removeEventListener('abort',abort);}
}
export class MediaFiles {
  readonly root:string;readonly objects:string;readonly work:string;
  private initialized:string|undefined;
  constructor(directory:string,readonly store:MediaStore,readonly maxBytes=1024**3,readonly maxAssetBytes=64*1024**2){this.root=resolve(directory);this.objects=join(this.root,'objects');this.work=join(this.root,'work');}
  async initialize(){await mkdir(this.root,{recursive:true});this.initialized=await realpath(this.root);
    for(const child of [this.objects,this.work]){await mkdir(child,{recursive:true});await contained(this.root,child);if((await lstat(child)).isSymbolicLink())throw new Error('MEDIA_PATH_ESCAPE');}
    await this.cleanPending();
  }
  private async rootCurrent(){if(!this.initialized||await realpath(this.root)!==this.initialized)throw new Error('MEDIA_PATH_CHANGED');}
  async path(hash:string){z.string().regex(/^[a-f0-9]{64}$/).parse(hash);await this.rootCurrent();const prefix=join(this.objects,hash.slice(0,2));await mkdir(prefix,{recursive:true});await contained(this.root,prefix);
    if((await lstat(prefix)).isSymbolicLink())throw new Error('MEDIA_PATH_ESCAPE');return join(prefix,hash);}
  async verified(ref:MediaAssetRef){const file=await this.path(ref.sha256);await contained(this.root,file);const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink()||info.size!==ref.bytes)throw new Error('MEDIA_BLOB_CORRUPT');
    const actual=await hashFile(file,ref.bytes);if(actual.sha256!==ref.sha256||actual.bytes!==ref.bytes)throw new Error('MEDIA_BLOB_CORRUPT');return file;}
  async bytes(ref:MediaAssetRef,signal:AbortSignal,guard:()=>void,maximum=16*1024**2){if(ref.bytes>maximum)throw new Error('MEDIA_SIZE_LIMIT');guard();signal.throwIfAborted();const path=await this.verified(ref),file=await open(path,'r');
    try{const result=Buffer.alloc(ref.bytes);let offset=0;while(offset<result.length){guard();signal.throwIfAborted();const part=await file.read(result,offset,Math.min(65536,result.length-offset),offset);if(!part.bytesRead)throw new Error('MEDIA_BLOB_CORRUPT');offset+=part.bytesRead;}
      const extra=await file.read(Buffer.alloc(1),0,1,result.length);if(extra.bytesRead||createHash('sha256').update(result).digest('hex')!==ref.sha256)throw new Error('MEDIA_BLOB_CORRUPT');guard();signal.throwIfAborted();return result;
    }finally{await file.close();}
  }
  private async remove(hash:string){const file=await this.path(hash);try{await contained(this.root,file);if((await lstat(file)).isSymbolicLink())throw new Error('MEDIA_PATH_ESCAPE');await unlink(file);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}}
  async cleanPending(){for(const blob of this.store.pendingRemoval()){await this.remove(blob.sha256);this.store.completeRemoval(blob.sha256,()=>{});}}
  async capacity(required:number){if(required>this.maxAssetBytes||required>this.maxBytes)throw new Error('MEDIA_SIZE_LIMIT');await this.cleanPending();
    for(const candidate of this.store.reclaimable(Date.now())){if(this.store.counts().bytes+required<=this.maxBytes)break;
      // Persist unavailability before unlink. A failed unlink remains charged and recoverable.
      this.store.beginEviction(candidate.sha256,Date.now());await this.remove(candidate.sha256);this.store.completeRemoval(candidate.sha256,()=>{});
    }if(this.store.counts().bytes+required>this.maxBytes)throw new Error('MEDIA_CACHE_FULL');
  }
  async ingest(access:MediaAccess,requestId:string,source:StoredMediaSource,stream:MediaByteStream,signal:AbortSignal,options:{kind?:MediaAssetRecord['kind'];processingHash?:string;parent?:MediaAssetRef;coverage?:MediaCoverage}={}):Promise<MediaAssetRef>{
    access.guard();await this.rootCurrent();
    const reservation=this.store.reserve(access,requestId,source,options.processingHash??null,options.parent??null),prior=this.store.read(access,reservation.id);
    if(prior.state==='ready'){const ref=this.store.ref(prior);await this.verified(ref);return ref;}if(prior.state!=='staging')throw new Error('MEDIA_ASSET_UNAVAILABLE');
    try{if(stream.bytes!==null)await this.capacity(stream.bytes);}catch(error){this.store.abandon(access,reservation.id,'MEDIA_CACHE_FULL');throw error;}
    const temporary=join(this.work,'acquire-'+randomUUID()+'.part'),file=await open(temporary,'wx').catch(error=>{this.store.abandon(access,reservation.id,'MEDIA_WRITE_FAILED');throw error;}),hash=createHash('sha256');let bytes=0,stagedHash:string|null=null;
    const iterator=stream.stream[Symbol.asyncIterator]();
    try{
      while(true){const next=await nextWithAbort(iterator,signal);if(next.done)break;access.guard();if(!(next.value instanceof Uint8Array))throw new Error('MEDIA_BYTES_INVALID');const chunk=Buffer.from(next.value);bytes+=chunk.length;
        if(bytes>this.maxAssetBytes)throw new Error('MEDIA_SIZE_LIMIT');await this.capacity(bytes);hash.update(chunk);let offset=0;
        while(offset<chunk.length){const written=await file.write(chunk,offset,chunk.length-offset);if(written.bytesWritten<1)throw new Error('MEDIA_WRITE_FAILED');offset+=written.bytesWritten;}}
      signal.throwIfAborted();access.guard();if(stream.bytes!==null&&bytes!==stream.bytes)throw new Error('MEDIA_SOURCE_TRUNCATED');await file.sync();await file.close();
      const sha256=hash.digest('hex'),destination=await this.path(sha256);
      if(this.store.reserveBlob(access,reservation.id,sha256,bytes))stagedHash=sha256;
      try{await link(temporary,destination);}catch(error){if(error instanceof Error&&'code'in error&&error.code==='EEXIST'){
          const existing=await hashFile(await contained(this.root,destination));if(existing.sha256!==sha256||existing.bytes!==bytes)throw new Error('MEDIA_BLOB_CORRUPT');
        }else{await copyFile(temporary,destination,constants.COPYFILE_EXCL);}}
      await unlink(temporary);access.guard();const verified=await hashFile(destination);if(verified.sha256!==sha256||verified.bytes!==bytes)throw new Error('MEDIA_BLOB_CORRUPT');
      const result=this.store.publish(access,reservation.id,{sha256,bytes,mime:stream.mime??'application/octet-stream',kind:options.kind??source.description.kind,
        coverage:options.coverage??{acquiredBytes:bytes,processed:[],exposed:false,gaps:[],completeness:'unknown'}},()=>true);
      stagedHash=null;return result;
    }catch(error){this.store.abandon(access,reservation.id,error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MEDIA_ACQUIRE_FAILED');if(stagedHash){this.store.abandonBlob(reservation.id,stagedHash);await this.cleanPending();}throw error;}
    finally{await file.close().catch(()=>{});void iterator.return?.().catch(()=>{});try{await contained(this.root,temporary);await unlink(temporary);}catch(error){if(!(error instanceof Error&&'code'in error&&error.code==='ENOENT'))throw error;}}
  }
  async cleanWork(){await this.rootCurrent();for(const entry of await readdir(this.work,{withFileTypes:true})){
    if(!/^(?:acquire-[a-f0-9-]{36}\.part|(?:process|job)-[a-zA-Z0-9]+)$/.test(entry.name))continue;
    const target=join(this.work,entry.name);await contained(this.root,target);if((await lstat(target)).isSymbolicLink())throw new Error('MEDIA_PATH_ESCAPE');await rm(target,{recursive:entry.isDirectory(),force:true});
  }}
}
