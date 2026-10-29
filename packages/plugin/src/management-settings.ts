import {readFileSync,writeFileSync,renameSync,unlinkSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import {isAbsolute,dirname,join} from 'node:path';
import {InstallationSettingsSchema,SettingsError} from './settings.js';
import {managementModules} from './management-catalog.js';
import type {Json} from '@dafeiyu/contracts';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
export function readPath(value:unknown,path:string):unknown {return path.split('.').reduce<unknown>((obj,key)=>obj&&typeof obj==='object'&&!Array.isArray(obj)?Reflect.get(obj,key):undefined,value);}
function putPath(root:Record<string,unknown>,path:string,value:Json){const keys=path.split('.');let node=root;
  for(const key of keys.slice(0,-1)){const next=node[key];if(!next||typeof next!=='object'||Array.isArray(next))node[key]={};node=node[key] as Record<string,unknown>;}
  if(value===null)delete node[keys.at(-1)!];else node[keys.at(-1)!]=value;
}
export class ManagementSettings {
  constructor(readonly file:string){}
  private read(){if(!this.file||!isAbsolute(this.file))throw new Error('INSTALL_SETTINGS_ABSOLUTE_PATH_REQUIRED');let bytes:string;
    try{bytes=readFileSync(this.file,'utf8');}catch(error){if(!error||typeof error!=='object'||!('code'in error)||error.code!=='ENOENT')throw error;return {bytes:'',raw:{schemaVersion:1,instanceName:'dafeiyu',dataDir:join(dirname(this.file),'dafeiyu-data'),model:{auth:'dsh-account',model:'deepseek-chat',credentialStore:''},qq:{botId:'',ownerId:'',tokenFile:'',httpURL:'http://127.0.0.1:13000',wsURL:'ws://127.0.0.1:13001'},activity:{enabled:false}} as unknown};}
    if(Buffer.byteLength(bytes)>262144)throw new Error('INSTALL_SETTINGS_TOO_LARGE');return {bytes,raw:JSON.parse(bytes) as unknown};}
  describe(){const {bytes,raw}=this.read(),parsed=InstallationSettingsSchema.safeParse(raw);
    const values:Record<string,Json>={};for(const module of managementModules)for(const section of module.sections)for(const field of section.fields){const value=readPath(parsed.success?parsed.data:raw,field.path);values[field.path]=(value===undefined?null:value) as Json;}
    return {revision:digest(bytes),values,...(!parsed.success?{error:'INSTALL_CONFIGURATION_REQUIRED',fields:parsed.error.issues.map(item=>item.path.join('.'))}:{})};}
  apply(revision:string,changes:readonly {module:string;values:Record<string,Json>}[]){const values:Record<string,Json>={};
    for(const change of changes){const module=managementModules.find(item=>item.id===change.module);if(!module)throw new Error('MANAGEMENT_MODULE_UNKNOWN');
      const allowed=new Set(module.sections.flatMap(section=>[...section.fields.map(field=>field.path),...(section.optionalPath?[section.optionalPath]:[])]));if(!Object.keys(change.values).length||Object.keys(change.values).some(key=>!allowed.has(key)||Object.hasOwn(values,key)))throw new Error('MANAGEMENT_FIELD_INVALID');Object.assign(values,change.values);}
    if(!Object.keys(values).length)throw new Error('MANAGEMENT_FIELD_INVALID');
    const {bytes,raw}=this.read();if(digest(bytes)!==revision)throw new Error('MANAGEMENT_REVISION_CONFLICT');
    if(!raw||typeof raw!=='object'||Array.isArray(raw))throw new Error('MANAGEMENT_CONFIGURATION_INVALID');const root=structuredClone(raw) as Record<string,unknown>;for(const [path,value] of Object.entries(values))putPath(root,path,value);
    const checked=InstallationSettingsSchema.safeParse(root);if(!checked.success)throw new SettingsError(checked.error.issues.map(item=>item.path.join('.')));
    const next=JSON.stringify(checked.data,null,2)+'\n',temp=this.file+'.'+randomUUID()+'.tmp';
    try{writeFileSync(temp,next,{flag:'wx',mode:0o600});if(digest(this.read().bytes)!==revision)throw new Error('MANAGEMENT_REVISION_CONFLICT');if(bytes==='')writeFileSync(this.file,next,{flag:'wx',mode:0o600});else renameSync(temp,this.file);}finally{try{unlinkSync(temp);}catch{}}
    return {revision:digest(next),applies:'next-start' as const};}
}
