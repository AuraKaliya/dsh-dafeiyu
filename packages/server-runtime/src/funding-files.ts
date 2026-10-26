import { closeSync,existsSync,fsyncSync,lstatSync,openSync,readFileSync,realpathSync,writeFileSync } from 'node:fs';
import { dirname,join,parse,relative,resolve,sep } from 'node:path';
import { z } from 'zod';
import { FundingAuthorizationSchema,FundingBindingSchema,FundingIdSchema,FundingPathSchema,FundingPriceSchema,checkFundingPurpose,fundingBytesHash,fundingCheck,fundingFreeze,fundingHash } from './funding-config.js';
import type { FundingBinding,FundingMode } from './funding-config.js';

const normalized=(path:string)=>process.platform==='win32'?resolve(path).toLowerCase():resolve(path);
const inside=(path:string,root:string)=>{const value=relative(root,path);return value===''||value!=='..'&&!value.startsWith('..'+sep)&&!parse(value).root;};
/** No symlink/junction ancestors. BigInt file identities avoid Windows inode precision loss. */
export function fundingPathIdentity(raw:string,kind:'directory'|'file'):string {
  const path=FundingPathSchema.parse(raw),absolute=resolve(path),root=parse(absolute).root;
  let current=root;
  for(const part of relative(root,absolute).split(sep).filter(Boolean)){
    current=join(current,part);const entry=lstatSync(current,{bigint:true});fundingCheck(!entry.isSymbolicLink(),'FUNDING_PATH_LINK_DENIED');
    if(current!==absolute)fundingCheck(entry.isDirectory(),'FUNDING_PATH_INVALID');
  }
  const entry=lstatSync(absolute,{bigint:true});fundingCheck(kind==='directory'?entry.isDirectory():entry.isFile()&&entry.nlink===1n,'FUNDING_PATH_INVALID');
  fundingCheck(normalized(realpathSync.native(absolute))===normalized(absolute),'FUNDING_PATH_LINK_DENIED');
  return fundingHash({path:normalized(absolute),dev:String(entry.dev),ino:String(entry.ino)});
}
export function readFundingJson<T>(file:string,schema:z.ZodType<T>,expectedHash?:string):T {
  const identity=fundingPathIdentity(file,'file'),info=lstatSync(file,{bigint:true});fundingCheck(info.size>0n&&info.size<=65536n,'FUNDING_DOCUMENT_INVALID');
  const bytes=readFileSync(file);fundingCheck(fundingPathIdentity(file,'file')===identity&&(expectedHash===undefined||fundingBytesHash(bytes)===expectedHash),'FUNDING_FILE_CHANGED');
  try{return schema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)) as unknown);}catch{throw new Error('FUNDING_DOCUMENT_INVALID');}
}
export function fundingPaths(binding:FundingBinding){return {directory:join(binding.windowsRoot.path,binding.fundingId),database:join(binding.windowsRoot.path,binding.fundingId,'operations-budget.sqlite'),
  claim:join(binding.receiptsRoot.path,binding.fundingId+'.initializing.json'),complete:join(binding.receiptsRoot.path,binding.fundingId+'.initialized.json')};}
export function validateFundingFiles(raw:FundingBinding,mode:FundingMode='operations'){
  const binding=FundingBindingSchema.parse(raw);
  fundingCheck(binding.windowsRoot.identity===fundingPathIdentity(binding.windowsRoot.path,'directory')&&binding.receiptsRoot.identity===fundingPathIdentity(binding.receiptsRoot.path,'directory'),'FUNDING_ROOT_CHANGED');
  fundingCheck(!inside(binding.windowsRoot.path,binding.receiptsRoot.path)&&!inside(binding.receiptsRoot.path,binding.windowsRoot.path),'FUNDING_ROOT_OVERLAP');
  const paths=fundingPaths(binding);
  for(const file of [binding.authorization.path,binding.price.path])fundingCheck(!inside(file,binding.windowsRoot.path)&&!inside(file,binding.receiptsRoot.path),'FUNDING_CONTROL_PATH_INVALID');
  const authorization=readFundingJson(binding.authorization.path,FundingAuthorizationSchema,binding.authorization.hash),price=readFundingJson(binding.price.path,FundingPriceSchema,binding.price.hash),routeHash=fundingHash(binding.route);
  checkFundingPurpose(authorization.purpose,authorization.approval,mode);
  fundingCheck(authorization.fundingId===binding.fundingId&&authorization.profileId===binding.profileId&&authorization.agentId===binding.agentId&&authorization.scopeHash===binding.scopeHash&&authorization.routeHash===routeHash&&authorization.priceHash===binding.price.hash,'FUNDING_BINDING_MISMATCH');
  fundingCheck(price.provider===binding.route.provider&&price.model===binding.route.model&&price.routeHash===routeHash,'FUNDING_PRICE_MISMATCH');
  return fundingFreeze({binding,authorization,price,paths});
}
export type ValidatedFunding=ReturnType<typeof validateFundingFiles>;
export const FundingInitReceiptSchema=z.strictObject({schemaVersion:z.literal(1),state:z.enum(['initializing','initialized']),fundingId:FundingIdSchema,bindingHash:z.string().regex(/^[a-f0-9]{64}$/),authorizationHash:z.string().regex(/^[a-f0-9]{64}$/),database:FundingPathSchema,
  databaseIdentity:z.string().regex(/^[a-f0-9]{64}$/).nullable(),directoryIdentity:z.string().regex(/^[a-f0-9]{64}$/).nullable(),at:z.iso.datetime()});
export function verifyFundingReceipts(value:ValidatedFunding):void {
  fundingCheck(existsSync(value.paths.claim)&&existsSync(value.paths.complete)&&existsSync(value.paths.database),'FUNDING_INITIALIZATION_INCOMPLETE');
  const first=readFundingJson(value.paths.claim,FundingInitReceiptSchema),last=readFundingJson(value.paths.complete,FundingInitReceiptSchema);
  for(const receipt of [first,last])fundingCheck(receipt.fundingId===value.binding.fundingId&&receipt.bindingHash===fundingHash(value.binding)&&receipt.authorizationHash===value.binding.authorization.hash&&normalized(receipt.database)===normalized(value.paths.database),'FUNDING_RECEIPT_MISMATCH');
  fundingCheck(first.state==='initializing'&&last.state==='initialized'&&Date.parse(first.at)<=Date.parse(last.at),'FUNDING_RECEIPT_MISMATCH');
  fundingCheck(first.databaseIdentity===null&&first.directoryIdentity===null&&last.directoryIdentity===fundingPathIdentity(value.paths.directory,'directory')&&last.databaseIdentity===fundingPathIdentity(value.paths.database,'file'),'FUNDING_RECEIPT_MISMATCH');
}
export function exclusiveFundingJson(path:string,value:unknown):void {
  fundingPathIdentity(dirname(path),'directory');const descriptor=openSync(path,'wx');
  try{writeFileSync(descriptor,JSON.stringify(value)+'\n');fsyncSync(descriptor);}finally{closeSync(descriptor);}
}
