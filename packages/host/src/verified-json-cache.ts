import {lstatSync,readFileSync,writeFileSync,linkSync,unlinkSync} from 'node:fs';
import {randomUUID} from 'node:crypto';

/** Immutable file contents only. Authorization is checked by the caller on every use. */
export class VerifiedJsonCache<T> {
  private readonly rows=new Map<string,{stamp:string;bytes:number;value:T}>();
  private bytes=0;
  private diskLoads=0;
  private cacheHits=0;
  constructor(private readonly parse:(raw:unknown)=>T,private readonly entries=128,private readonly maxBytes=8*1024*1024,private readonly maxFileBytes=4*1024*1024){}
  private identity(file:string){const stat=lstatSync(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size>this.maxFileBytes)throw new Error('ARCHIVE_FILE_INVALID');
    return {stamp:[stat.dev,stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':'),bytes:Number(stat.size)};}
  private remove(file:string){const old=this.rows.get(file);if(old){this.bytes-=old.bytes;this.rows.delete(file);}}
  get(file:string):T{
    let before:ReturnType<VerifiedJsonCache<T>['identity']>;try{before=this.identity(file);}catch(error){this.remove(file);throw error;}
    const old=this.rows.get(file);if(old?.stamp===before.stamp){this.rows.delete(file);this.rows.set(file,old);this.cacheHits++;return old.value;}
    this.remove(file);const value=this.parse(JSON.parse(readFileSync(file,'utf8')));this.diskLoads++;
    if(this.identity(file).stamp!==before.stamp)throw new Error('ARCHIVE_CHANGED_DURING_READ');
    while(this.rows.size&&(this.rows.size>=this.entries||this.bytes+before.bytes>this.maxBytes))this.remove(this.rows.keys().next().value!);
    if(before.bytes<=this.maxBytes){this.rows.set(file,{...before,value});this.bytes+=before.bytes;}return value;
  }
  diagnostics(){return {diskLoads:this.diskLoads,cacheHits:this.cacheHits,cachedResults:this.rows.size,cachedBytes:this.bytes};}
}

/** Fully written UTF-8 file becomes visible atomically; an existing receipt cannot be replaced. */
export function publishJson(file:string,value:unknown){const temp=file+'.'+randomUUID()+'.tmp';writeFileSync(temp,JSON.stringify(value),{flag:'wx'});try{linkSync(temp,file);}finally{unlinkSync(temp);}}
