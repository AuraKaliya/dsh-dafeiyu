import { z } from 'zod';
import { mkdtemp,writeFile,rm,stat } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoundedProcess,contained } from './process.js';
import { hashFile } from './files.js';
export const documentConfigSchema=z.strictObject({python:z.string().min(1),pypdfVersion:z.literal('6.10.0').default('6.10.0')});
const resultSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.enum(['text','json','csv','pdf','docx','xlsx']),sha256:z.string().length(64),bytes:z.number().int().nonnegative(),
  units:z.array(z.strictObject({kind:z.enum(['page','paragraph','row']),locator:z.string().max(400),text:z.string().max(5000),cachedFormula:z.boolean().optional(),index:z.number().int().nonnegative(),textStart:z.number().int().nonnegative(),textEnd:z.number().int().nonnegative()})).max(64),
  next:z.strictObject({offset:z.number().int().nonnegative(),textOffset:z.number().int().nonnegative()}).nullable(),totalUnits:z.number().int().nonnegative().nullable(),gaps:z.array(z.string().max(300)).max(20)});
export class DocumentReader {
  constructor(private readonly root:string,private readonly allowed:string,private readonly config:z.output<typeof documentConfigSchema>,private readonly worker=new BoundedProcess(root)){}
  async read(input:{file:string;name:string;offset:number;textOffset:number;limit:number},signal:AbortSignal,guard:()=>void){guard();signal.throwIfAborted();const file=await contained(this.allowed,input.file);if((await stat(file)).size>16*1024**2)throw new Error('MEDIA_DOCUMENT_SIZE_LIMIT');
    const hash=await hashFile(file),directory=await mkdtemp(join(this.root,'job-'));await contained(this.root,directory);
    try{const request=join(directory,'document.json');await writeFile(request,JSON.stringify({...input,input:file,pypdfVersion:this.config.pypdfVersion}),{flag:'wx'});
      const execution=await this.worker.run({executable:this.config.python,arguments:[fileURLToPath(new URL('../workers/documents.py',import.meta.url)),request],memoryBytes:512*1024**2,timeoutMs:120000,maxStdoutBytes:128*1024,maxStderrBytes:8192,signal});
      signal.throwIfAborted();guard();const raw=z.discriminatedUnion('ok',[z.strictObject({ok:z.literal(true),result:resultSchema}),z.strictObject({ok:z.literal(false),code:z.string().regex(/^MEDIA_[A-Z0-9_]{1,100}$/)})]).parse(JSON.parse(execution.stdout.toString('utf8')));
      if(!raw.ok)throw new Error(raw.code);const result=raw.result;if(result.sha256!==hash.sha256||result.bytes!==hash.bytes||result.units.reduce((n,u)=>n+u.text.length,0)>input.limit)throw new Error('MEDIA_DOCUMENT_RESULT_INVALID');
      return result;
    }finally{await contained(this.root,directory);await rm(directory,{recursive:true,force:true});}
  }
}
