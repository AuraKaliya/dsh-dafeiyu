import { existsSync,realpathSync,statSync } from 'node:fs';
import { dirname,resolve,join,relative,sep,isAbsolute } from 'node:path';

export function physicalPath(path:string):string{const absolute=resolve(path);if(existsSync(absolute))return realpathSync.native(absolute);const parent=dirname(absolute);if(parent===absolute)return absolute;return join(physicalPath(parent),relative(parent,absolute));}
export function pathIdentity(path:string){const value=physicalPath(path);return process.platform==='win32'?value.toLowerCase():value;}
export function within(path:string,directory:string):boolean{const diff=relative(pathIdentity(directory),pathIdentity(path));return !diff||diff!=='..'&&!diff.startsWith('..'+sep)&&!isAbsolute(diff);}
export interface HostResource {readonly path:string;readonly identity:string;readonly kind:'directory'|'file'}
export function resource(path:string,kind:HostResource['kind']):HostResource{const target=physicalPath(path);if(existsSync(target)&&(kind==='directory'?!statSync(target).isDirectory():!statSync(target).isFile()))throw new Error('HOST_PATH_KIND_MISMATCH');return {path:target,identity:pathIdentity(target),kind};}
export function overlap(a:HostResource,b:HostResource):boolean{return a.identity===b.identity||a.kind==='directory'&&within(b.path,a.path)||b.kind==='directory'&&within(a.path,b.path);}
