import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { lstatSync,readFileSync,realpathSync,statSync } from 'node:fs';
import { dirname,isAbsolute,join,parse,resolve } from 'node:path';
import { z } from 'zod';
import { BiliOwnerIdSchema,BiliOwnerHashSchema,biliOwnerHash } from './types.js';

export const BILI_OWNER_AUTH_HASH='1aa6d5496a57661b05f81f49d7d62c85983eb6670445f65fe8dbc8a7225ad978';
export const BILI_OWNER_PRODUCTION_PROTOCOL='bili-owner-production.v1';
const absolute=z.string().min(1).max(1000).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value));
export const BiliOwnerProductionConfigSchema=z.strictObject({installationRoot:absolute,manifestPath:absolute,manifestHash:BiliOwnerHashSchema});
export type BiliOwnerProductionConfig=z.infer<typeof BiliOwnerProductionConfigSchema>;
export const BiliOwnerProductionManifestSchema=z.strictObject({schemaVersion:z.literal(1),kind:z.literal('bili-owner-channel'),enabled:z.literal(true),
  accountUid:BiliOwnerIdSchema,ownerUid:BiliOwnerIdSchema,generation:z.number().int().positive().safe(),authModuleHash:z.literal(BILI_OWNER_AUTH_HASH),publicConfigHash:BiliOwnerHashSchema});
export type BiliOwnerProductionManifest=z.infer<typeof BiliOwnerProductionManifestSchema>;
export interface PinnedBiliOwnerProductionBinding {readonly config:Readonly<BiliOwnerProductionConfig>;readonly manifest:Readonly<BiliOwnerProductionManifest>;readonly authSource:string;
  readonly identityHash:string;readonly bindingStamp:string;guard():void;credentialPathGuard():void}
const bindings=new WeakSet<object>();
const hash=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex');
const samePath=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);
function fail(code:string):never{throw new Error(code);}
/** Reject aliases/reparse points in every existing component, including a link above the installation root. */
function physical(path:string,directory:boolean,code:string){try{if(!samePath(path,realpathSync.native(path)))fail(code);
  let part=resolve(path);for(;;){if(lstatSync(part).isSymbolicLink())fail(code);const parent=dirname(part);if(parent===part)break;part=parent;}
  const stat=statSync(path);if(directory?!stat.isDirectory():!stat.isFile())fail(code);return stat;
}catch{fail(code);}}
function publicBytes(path:string,maximum:number,code:string){const stat=physical(path,false,code);if(stat.size>maximum)fail(code);const bytes=readFileSync(path);if(bytes.length>maximum)fail(code);return bytes;}
function publicConfig(path:string,expectedHash:string,identity:BiliOwnerProductionManifest){const bytes=publicBytes(path,131072,'BILI_OWNER_CONFIG_CHANGED');if(hash(bytes)!==expectedHash)fail('BILI_OWNER_CONFIG_CHANGED');
  try{const uid=z.union([BiliOwnerIdSchema,z.number().int().positive().safe().transform(String)]);
    const parsed=z.object({accountUid:uid,ownerUid:uid}).parse(JSON.parse(bytes.toString('utf8').replace(/^\uFEFF/,'')));
    if(parsed.accountUid!==identity.accountUid||parsed.ownerUid!==identity.ownerUid)fail('BILI_OWNER_ACCOUNT_MISMATCH');}
  catch{fail('BILI_OWNER_ACCOUNT_MISMATCH');}}
export function assertPinnedBiliOwnerProductionBinding(value:PinnedBiliOwnerProductionBinding){if(!bindings.has(value))fail('BILI_OWNER_PRODUCTION_BINDING_REQUIRED');value.guard();}

/** Reads only public deployment/source bytes. This does not open a credential file or perform platform IO. */
export function loadBiliOwnerProductionBinding(raw:unknown):PinnedBiliOwnerProductionBinding {
  const config=Object.freeze(BiliOwnerProductionConfigSchema.parse(raw));if(process.platform!=='win32'||!parse(config.installationRoot).root)fail('BILI_OWNER_WINDOWS_REQUIRED');
  const root=config.installationRoot,manifestPath=join(root,'配置文件','bili-owner-channel.json'),configPath=join(root,'配置文件','bilibili.json'),authPath=fileURLToPath(new URL('../../vendor/bili-auth.mjs',import.meta.url));
  if(!samePath(config.manifestPath,manifestPath))fail('BILI_OWNER_MANIFEST_PATH');physical(root,true,'BILI_OWNER_INSTALLATION_CHANGED');
  const manifestBytes=publicBytes(manifestPath,65536,'BILI_OWNER_MANIFEST_CHANGED');if(hash(manifestBytes)!==config.manifestHash)fail('BILI_OWNER_MANIFEST_CHANGED');
  let manifest:BiliOwnerProductionManifest;try{manifest=BiliOwnerProductionManifestSchema.parse(JSON.parse(manifestBytes.toString('utf8').replace(/^\uFEFF/,'')));}catch{fail('BILI_OWNER_MANIFEST_INVALID');}
  Object.freeze(manifest);
  const sourceBytes=publicBytes(authPath,65536,'BILI_OWNER_AUTH_CHANGED');if(hash(sourceBytes)!==BILI_OWNER_AUTH_HASH)fail('BILI_OWNER_AUTH_CHANGED');const authSource=sourceBytes.toString('utf8');
  const imports=[...authSource.matchAll(/^import\s+[^;]+?\s+from\s+['"]([^'"]+)['"];?\s*$/gm)].map(match=>match[1]);
  if(JSON.stringify(imports)!==JSON.stringify(['node:fs','node:path','node:crypto'])||/\b(?:import|require)\s*\(/.test(authSource))fail('BILI_OWNER_AUTH_DEPENDENCY');
  const identityHash=biliOwnerHash({protocol:BILI_OWNER_PRODUCTION_PROTOCOL,accountUid:manifest.accountUid,ownerUid:manifest.ownerUid,generation:manifest.generation});
  const guard=()=>{physical(root,true,'BILI_OWNER_INSTALLATION_CHANGED');if(hash(publicBytes(manifestPath,65536,'BILI_OWNER_MANIFEST_CHANGED'))!==config.manifestHash)fail('BILI_OWNER_MANIFEST_CHANGED');
    if(hash(publicBytes(authPath,65536,'BILI_OWNER_AUTH_CHANGED'))!==BILI_OWNER_AUTH_HASH)fail('BILI_OWNER_AUTH_CHANGED');publicConfig(configPath,manifest.publicConfigHash,manifest);};
  const value:PinnedBiliOwnerProductionBinding=Object.freeze({config,manifest,authSource,identityHash,bindingStamp:identityHash,guard,
    credentialPathGuard:()=>{guard();const path=join(root,'配置文件','凭据','bilibili.session.json'),stat=physical(path,false,'BILI_OWNER_LOGIN_REQUIRED');if(stat.size>262144)fail('BILI_OWNER_CREDENTIAL_INVALID');}});
  guard();bindings.add(value);return value;
}
