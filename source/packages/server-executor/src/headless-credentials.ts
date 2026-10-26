import { createHash } from 'node:crypto';
import { readFileSync,realpathSync,statSync } from 'node:fs';
import { isAbsolute,resolve } from 'node:path';
import { isMap,isScalar,parseDocument } from 'yaml';
import { z } from 'zod';
import { ExecutorHashSchema } from './types.js';

const absolute=z.string().min(1).max(2000).refine(value=>isAbsolute(value)&&!/^[/\\]{2}/.test(value));
export const HeadlessCredentialBindingSchema=z.strictObject({credentialStore:z.strictObject({path:absolute,hash:ExecutorHashSchema}),credentialName:z.literal('DEEPSEEK_API_KEY'),
  baseURL:z.url().refine(value=>{const url=new URL(value);return url.protocol==='https:'&&!url.username&&!url.password&&!url.search&&!url.hash;})});
export type HeadlessCredentialBinding=z.infer<typeof HeadlessCredentialBindingSchema>;
export interface HeadlessCredentialMetadata {schemaVersion:1;credentialName:'DEEPSEEK_API_KEY';source:'file';configured:true;storeHash:string}
const samePath=(a:string,b:string)=>process.platform==='win32'?resolve(a).toLowerCase()===resolve(b).toLowerCase():resolve(a)===resolve(b);

/** Runtime-only fingerprint and format check. Never returns, logs, copies, or resolves the credential value. */
export function inspectPinnedModelCredential(raw:HeadlessCredentialBinding):HeadlessCredentialMetadata{
  const binding=HeadlessCredentialBindingSchema.parse(raw),file=binding.credentialStore.path;let bytes:Buffer|undefined;
  try{
    if(!samePath(realpathSync.native(file),file))throw new Error('EXECUTOR_CREDENTIAL_PATH_CHANGED');
    const stat=statSync(file);if(!stat.isFile()||stat.size<1||stat.size>1024*1024)throw new Error('EXECUTOR_CREDENTIAL_STORE_INVALID');
    bytes=readFileSync(file);if(createHash('sha256').update(bytes).digest('hex')!==binding.credentialStore.hash)throw new Error('EXECUTOR_CREDENTIAL_STORE_CHANGED');
    const document=parseDocument(bytes.toString('utf8'),{logLevel:'silent',uniqueKeys:true});
    if(document.errors.length||document.warnings.length||!isMap(document.contents))throw new Error('EXECUTOR_CREDENTIAL_STORE_UNSUPPORTED');
    const keys=document.contents.items.map(item=>isScalar(item.key)&&typeof item.key.value==='string'?item.key.value:null);
    if(keys.some(key=>key===null||!['version','refs','records'].includes(key))||document.get('version')!==1)throw new Error('EXECUTOR_CREDENTIAL_STORE_UNSUPPORTED');
    const refs=document.get('refs',true),records=document.get('records',true);
    if(!isMap(refs)||refs.items.length!==1)throw new Error('EXECUTOR_CREDENTIAL_REFERENCE_MISMATCH');
    const selected=refs.items[0];if(!selected||!isScalar(selected.key)||selected.key.value!==binding.credentialName)throw new Error('EXECUTOR_CREDENTIAL_REFERENCE_MISMATCH');
    if(records!==undefined&&(!isMap(records)||records.items.length!==0))throw new Error('EXECUTOR_CREDENTIAL_EXTRA_RECORDS');
    const value=selected.value;if(!isScalar(value)||typeof value.value!=='string'||value.value.length===0)throw new Error('EXECUTOR_CREDENTIAL_REFERENCE_MISSING');
    return {schemaVersion:1,credentialName:binding.credentialName,source:'file',configured:true,storeHash:binding.credentialStore.hash};
  }catch(error){
    if(error instanceof Error&&/^EXECUTOR_CREDENTIAL_[A-Z_]+$/.test(error.message))throw error;
    throw new Error('EXECUTOR_CREDENTIAL_STORE_UNAVAILABLE');
  }finally{bytes?.fill(0);}
}

/** Describe is the official metadata-only API; the native adapter alone resolves the selected key for an actual request. */
export async function assertPinnedCredentialDescription(service:unknown,binding:HeadlessCredentialBinding):Promise<void>{
  inspectPinnedModelCredential(binding);
  if(!service||typeof service!=='object'||!('describe'in service)||typeof service.describe!=='function')throw new Error('EXECUTOR_CREDENTIAL_SERVICE_MISSING');
  let description:unknown;try{description=await Reflect.apply(service.describe,service,[binding.credentialName]);}catch{throw new Error('EXECUTOR_CREDENTIAL_DESCRIPTION_FAILED');}
  if(!description||typeof description!=='object'||!('configured'in description)||description.configured!==true||!('source'in description)||description.source!=='file')throw new Error('EXECUTOR_CREDENTIAL_REFERENCE_MISSING');
  inspectPinnedModelCredential(binding);
}
