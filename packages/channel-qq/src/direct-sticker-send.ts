import {existsSync,mkdirSync,readFileSync,writeFileSync,renameSync,lstatSync,realpathSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export interface NamedQqGroup {id:string;name:string|null}
/** Only owner-authored text is supplied here. Forwarded/quoted/assistant text must never resolve a destination. */
export function directedStickerTarget(instruction:string,previousOwnerTexts:readonly string[],groups:readonly NamedQqGroup[],requested?:string):string{
  if(!/(表情|sticker)/iu.test(instruction)||!/(?:(?:发|送).{0,30}(?:到|给|进)|(?:给|往|向).{0,50}(?:发|送)|在.{0,40}群.{0,12}(?:发|送)|send.{0,70}(?:to|into))/iu.test(instruction)
    ||/(不要|别|禁止|不能|无需|不准|不用|do not|don't).{0,16}(发|送|send)/iu.test(instruction))throw new Error('QQ_GROUP_SEND_INSTRUCTION_REQUIRED');
  const matches=(text:string)=>groups.filter(group=>group.name&&text.includes(group.name)||new RegExp('(?<!\\d)'+group.id+'(?!\\d)').test(text));
  let candidates=matches(instruction);
  if(!candidates.length&&/(那个群|该群|这个群|刚才.{0,4}群|that group|same group)/iu.test(instruction)){
    for(const text of previousOwnerTexts){const found=matches(text);if(found.length){if(!/(不要|别|不是|禁止|不用)/u.test(text))candidates=found;break;}}
  }
  if(candidates.length!==1)throw new Error('QQ_GROUP_TARGET_AMBIGUOUS');
  if(requested&&requested!==candidates[0]!.id)throw new Error('QQ_GROUP_TARGET_MISMATCH');return candidates[0]!.id;
}
const bindingSchema=z.strictObject({sourceId:z.string(),sourceHash:z.string(),stickerId:z.uuid(),stickerVersion:z.number().int().positive(),sha256:z.string(),groupId:z.string(),groupGeneration:z.number().int().nonnegative()});
const recordSchema=z.strictObject({binding:bindingSchema,state:z.enum(['sending','sent','unknown','not-sent']),receiptId:z.string().nullable(),code:z.string().nullable(),at:z.string()});
export type DirectStickerBinding=z.infer<typeof bindingSchema>;
/** A durable claim is installed before dispatch. Any interrupted claim stays unknown; new tool IDs cannot resend it. */
export class QqDirectSendLedger {
  private readonly directory:string;
  constructor(directory:string){this.directory=resolve(directory);mkdirSync(this.directory,{recursive:true});if(lstatSync(this.directory).isSymbolicLink()||realpathSync(this.directory)!==this.directory)throw new Error('QQ_GROUP_SEND_PATH_INVALID');}
  private file(sourceId:string){return join(this.directory,hash(sourceId)+'.json');}
  read(sourceId:string){const file=this.file(sourceId);if(!existsSync(file))return null;try{const info=lstatSync(file);if(info.isSymbolicLink()||info.size>16000)throw new Error();return recordSchema.parse(JSON.parse(readFileSync(file,'utf8')));}catch{throw new Error('QQ_GROUP_SEND_LEDGER_UNCERTAIN');}}
  claim(binding:DirectStickerBinding){const body=recordSchema.parse({binding,state:'sending',receiptId:null,code:null,at:new Date().toISOString()});
    try{writeFileSync(this.file(binding.sourceId),JSON.stringify(body),{flag:'wx',encoding:'utf8',flush:true});return true;}
    catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='EEXIST')return false;throw error;}
  }
  settle(binding:DirectStickerBinding,state:'sent'|'unknown'|'not-sent',receiptId:string|null,code:string|null){const old=this.read(binding.sourceId);if(!old||hash(old.binding)!==hash(binding)||old.state!=='sending')throw new Error('QQ_GROUP_SEND_LEDGER_CONFLICT');
    const value=recordSchema.parse({...old,state,receiptId,code,at:new Date().toISOString()}),file=this.file(binding.sourceId),tmp=file+'.'+randomUUID()+'.tmp';writeFileSync(tmp,JSON.stringify(value),{flag:'wx',encoding:'utf8',flush:true});renameSync(tmp,file);return value;
  }
}
