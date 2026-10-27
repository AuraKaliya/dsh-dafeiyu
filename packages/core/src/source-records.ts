import { z } from 'zod';
import { createHash } from 'node:crypto';
import { pluginRecordOf,SessionSeq } from '@deepseek-ai/dsh-session';
import type { Session,SessionEvent } from '@deepseek-ai/dsh-session';
import { SourceDependencySchema } from '@dafeiyu/contracts';
import type { SourceDependency } from '@dafeiyu/contracts';

export const digestSource=(text:string)=>createHash('sha256').update(text).digest('hex');
export const dependenciesSchema=z.array(SourceDependencySchema).max(4096);
export function unionDependencies(...groups:readonly (readonly SourceDependency[])[]):SourceDependency[]{
  const items=new Map<string,SourceDependency>();for(const group of groups)for(const dep of group)items.set(JSON.stringify(dep),dep);
  return dependenciesSchema.parse([...items].sort(([a],[b])=>a.localeCompare(b)).map(([,dep])=>dep));
}
const scopeFields={agentId:z.string(),route:z.string(),traceId:z.string(),owner:z.string(),producerVersion:z.string()};
export const sourceRecordSchema=z.strictObject({...scopeFields,schemaVersion:z.literal(1),targetSeq:z.number().int().nonnegative(),
  hash:z.string(),parents:z.array(z.number().int().nonnegative()),dependencies:dependenciesSchema,requestSeq:z.number().int().nonnegative().optional()});
const requestSchema=z.strictObject({...scopeFields,turn:z.number().int(),step:z.number().int(),parents:z.array(z.number().int().nonnegative()),dependencies:dependenciesSchema,
  contexts:z.array(z.strictObject({owner:z.string(),region:z.string(),id:z.string(),version:z.string(),hash:z.string(),sources:z.array(z.strictObject({ref:z.string(),version:z.string(),hash:z.string()}))})).default([])});
export type SourceRecord=z.infer<typeof sourceRecordSchema>;
export const provenanceRecordSchema=z.discriminatedUnion('type',[
  z.object({type:z.literal('plugin:dafeiyu/source-record'),seq:z.number().transform(SessionSeq),data:sourceRecordSchema}),
  z.object({type:z.literal('plugin:dafeiyu/request-sources'),seq:z.number().transform(SessionSeq),data:requestSchema}),
]);
declare module '@deepseek-ai/dsh-session' { interface PluginRecordMap {
  'plugin:dafeiyu/source-invalid':{traceId:string;phase:'dispatch'|'stream';dependency:SourceDependency;dependencyHash:string;reason:string};
  'plugin:dafeiyu/source-record':SourceRecord;
  'plugin:dafeiyu/request-sources':z.infer<typeof requestSchema>;
} }
export function readProvenance(session:Session){return session.snapshotEvents().flatMap(event=>{
  const record=pluginRecordOf(event);return record&&(record.type==='plugin:dafeiyu/source-record'||record.type==='plugin:dafeiyu/request-sources')
    ?[provenanceRecordSchema.parse(record)]:[];
});}
export function eventText(event:SessionEvent|undefined):string|null {
  const message=event?.type==='user/message'?event.data:event?.type==='assistant/message'||event?.type==='tool/result'?event.data.message:null;
  return message?message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'):null;
}
