import { open,realpath,lstat } from 'node:fs/promises';
import { relative,isAbsolute,sep,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request } from 'node:https';
import type { RequestOptions } from 'node:https';
import type { IncomingMessage } from 'node:http';
import { z } from 'zod';
import type { MediaByteStream } from '@dafeiyu/contracts';
import type { QqMediaLocator } from './media-store.js';
import type { OneBot } from './onebot.js';

export const QqMediaConfigSchema=z.strictObject({enabled:z.boolean().default(false),sendEnabled:z.boolean().default(false),cacheRoots:z.array(z.string().min(1)).max(8).default([]),httpsHosts:z.array(z.string().regex(/^[a-zA-Z0-9.-]+$/)).max(16).default([]),maxReadBytes:z.number().int().min(1024).max(256*1024**2).default(64*1024**2),voiceDirectives:z.boolean().default(false)});
type Range={start:number;end:number}|null;
export function publicIpv4(value:string){if(isIP(value)!==4)return false;const [a,b,c]=value.split('.').map(Number);return a!==0&&a!==10&&a!==127&&a!>=1&&a!<224&&!(a===100&&b!>=64&&b!<=127)&&!(a===169&&b===254)&&!(a===172&&b!>=16&&b!<=31)&&!(a===192&&(b===168||b===0||b===2||b===88&&c===99))&&!(a===198&&(b===18||b===19||b===51&&c===100))&&!(a===203&&b===0&&c===113);}
function bounds(range:Range,total:number){const start=range?.start??0,end=range?.end??total-1;if(range&&(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start<0||end<start||end>=total))throw new Error('QQ_MEDIA_RANGE_INVALID');return {start,end};}

/** No caller-supplied paths or addresses: locators must come from the registered QQ source resolver. */
export class QqMediaReader {
  private readonly roots:string[];
  constructor(private readonly config:z.output<typeof QqMediaConfigSchema>){this.roots=config.cacheRoots.map(root=>resolve(root));}
  async local(file:string,range:Range,signal:AbortSignal,guard:()=>void):Promise<MediaByteStream>{
    guard();signal.throwIfAborted();let path=file;if(path.startsWith('file:')){const url=new URL(path);if(url.hostname||url.username||url.password||url.search||url.hash)throw new Error('QQ_MEDIA_PATH_DENIED');path=fileURLToPath(url);}
    if(!/^[a-zA-Z]:[\\/][^:\x00]+$/.test(path))throw new Error('QQ_MEDIA_PATH_DENIED');const actual=await realpath(path);let root:string|undefined;
    for(const candidate of this.roots){if((await lstat(candidate)).isSymbolicLink())throw new Error('QQ_MEDIA_PATH_DENIED');const base=await realpath(candidate),delta=relative(base,actual);if(delta&&delta!=='..'&&!delta.startsWith('..'+sep)&&!isAbsolute(delta)){root=base;break;}}
    if(!root||(await lstat(path)).isSymbolicLink())throw new Error('QQ_MEDIA_PATH_DENIED');const handle=await open(actual,'r');
    try{const initial=await handle.stat();if(!initial.isFile())throw new Error('QQ_MEDIA_PATH_DENIED');const selected=bounds(range,initial.size),bytes=range?selected.end-selected.start+1:initial.size;
      if(bytes>this.config.maxReadBytes)throw new Error('QQ_MEDIA_SIZE_LIMIT');const abort=()=>{void handle.close().catch(()=>{});};signal.addEventListener('abort',abort,{once:true});
      const stream=(async function*(){let offset=selected.start;
        try{while(offset<=selected.end){signal.throwIfAborted();guard();if(await realpath(path)!==actual)throw new Error('QQ_MEDIA_PATH_CHANGED');const buffer=Buffer.alloc(Math.min(65536,selected.end-offset+1)),read=await handle.read(buffer,0,buffer.length,offset);
          if(!read.bytesRead)throw new Error('QQ_MEDIA_TRUNCATED');offset+=read.bytesRead;yield buffer.subarray(0,read.bytesRead);}
          guard();const final=await handle.stat();if(final.size!==initial.size||final.mtimeMs!==initial.mtimeMs||final.ino!==initial.ino)throw new Error('QQ_MEDIA_FILE_CHANGED');
        }finally{signal.removeEventListener('abort',abort);await handle.close();}
      })();if(signal.aborted){abort();signal.throwIfAborted();}return {bytes,totalBytes:initial.size,range:range?selected:null,mime:null,stream};
    }catch(error){await handle.close();throw error;}
  }
  private async remote(value:string,range:Range,signal:AbortSignal,guard:()=>void):Promise<MediaByteStream>{const url=new URL(value);guard();signal.throwIfAborted();
    if(url.protocol!=='https:'||url.port&&url.port!=='443'||url.username||url.password||url.hash||isIP(url.hostname)||!this.config.httpsHosts.map(h=>h.toLowerCase()).includes(url.hostname.toLowerCase()))throw new Error('QQ_MEDIA_URL_DENIED');
    const addresses=await lookup(url.hostname,{all:true});signal.throwIfAborted();guard();const address=addresses.find(a=>a.family===4&&publicIpv4(a.address));
    if(!address||addresses.some(a=>a.family===4&&!publicIpv4(a.address)||a.family===6&&!/^[23][0-9a-f]{3}:/i.test(a.address)))throw new Error('QQ_MEDIA_ADDRESS_DENIED');
    const pinned:NonNullable<RequestOptions['lookup']>=(_host,options,callback)=>{if(options.all)callback(null,[address]);else callback(null,address.address,4);};
    const response=await new Promise<IncomingMessage>((done,reject)=>{const req=request(url,{method:'GET',lookup:pinned,headers:{'Accept-Encoding':'identity',...(range?{Range:`bytes=${range.start}-${range.end}`}:{})},signal},done);req.on('error',()=>reject(new Error(signal.aborted?'QQ_MEDIA_CANCELLED':'QQ_MEDIA_HTTP_FAILED')));req.end();});
    response.on('error',()=>{});const fail=(code:string):never=>{response.destroy();throw new Error(code);};try{guard();signal.throwIfAborted();
    if(response.statusCode!==(range?206:200)||response.headers['content-encoding']&&response.headers['content-encoding']!=='identity')fail('QQ_MEDIA_HTTP_UNSUPPORTED');
    let total:number|undefined;const length=response.headers['content-length']===undefined?null:Number(response.headers['content-length']);if(length!==null&&(!Number.isSafeInteger(length)||length<0||length>this.config.maxReadBytes))fail('QQ_MEDIA_SIZE_LIMIT');
    if(range){const parsed=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers['content-range']??'');if(!parsed||Number(parsed[1])!==range.start||Number(parsed[2])!==range.end||length!==range.end-range.start+1)fail('QQ_MEDIA_RANGE_UNCONFIRMED');total=Number(parsed![3]);if(!Number.isSafeInteger(total)||range.end>=total)fail('QQ_MEDIA_RANGE_UNCONFIRMED');}
    const maximum=this.config.maxReadBytes,stream=(async function*(){let received=0;try{for await(const chunk of response){signal.throwIfAborted();guard();if(!(chunk instanceof Uint8Array))throw new Error('QQ_MEDIA_BYTES_INVALID');received+=chunk.length;if(received>maximum)throw new Error('QQ_MEDIA_SIZE_LIMIT');yield Buffer.from(chunk);}guard();if(length!==null&&received!==length)throw new Error('QQ_MEDIA_TRUNCATED');}finally{response.destroy();}})();
    return {bytes:length,mime:null,...(total===undefined?{}:{totalBytes:total}),range,stream};
    }catch(error){response.destroy();throw error;}
  }
  async open(location:string,range:Range,signal:AbortSignal,guard:()=>void){return location.startsWith('https:')?this.remote(location,range,signal,guard):this.local(location,range,signal,guard);}
  async resolve(api:Pick<OneBot,'call'|'verify'>,kind:'image'|'audio'|'video'|'document',locator:QqMediaLocator,range:Range,signal:AbortSignal,guard:()=>void):Promise<MediaByteStream>{
    guard();signal.throwIfAborted();await api.verify(signal);guard();const params=locator.fileId?{file_id:locator.fileId}:locator.file?{file:locator.file}:null;
    let location:string;
    if(params){const raw=await api.call(kind==='image'?'get_image':kind==='audio'?'get_record':'get_file',{...params,...(kind==='audio'?{out_format:'wav'}:{})},signal);
      const result=z.object({file:z.string().max(8192).optional(),url:z.string().max(8192).optional(),base64:z.string().max(32*1024**2).optional(),out_format:z.string().optional()}).parse(raw);
      if(kind==='audio'&&result.base64!==undefined){
        if(result.out_format!=='wav'||result.base64.length%4!==0||!/^[A-Za-z0-9+/]*={0,2}$/.test(result.base64))throw new Error('QQ_MEDIA_AUDIO_CONVERSION_INVALID');
        const data=Buffer.from(result.base64,'base64');if(data.length>this.config.maxReadBytes)throw new Error('QQ_MEDIA_SIZE_LIMIT');
        if(data.length<44||data.toString('ascii',0,4)!=='RIFF'||data.toString('ascii',8,12)!=='WAVE')throw new Error('QQ_MEDIA_AUDIO_CONVERSION_INVALID');
        await api.verify(signal);guard();const selected=bounds(range,data.length),bytes=range?selected.end-selected.start+1:data.length;
        return {bytes,totalBytes:data.length,mime:'audio/wav',range:range?selected:null,stream:(async function*(){guard();signal.throwIfAborted();yield data.subarray(selected.start,selected.end+1);guard();await api.verify(signal);guard();})()};
      }
      location=result.file??result.url??'';
    }else{if(kind==='audio')throw new Error('QQ_MEDIA_AUDIO_CONVERSION_REQUIRED');location=locator.url??'';}
    guard();await api.verify(signal);guard();const opened=await this.open(location,range,signal,guard),iterator=opened.stream;
    return {...opened,stream:(async function*(){for await(const bytes of iterator){guard();signal.throwIfAborted();yield bytes;}guard();await api.verify(signal);guard();})()};
  }
}
