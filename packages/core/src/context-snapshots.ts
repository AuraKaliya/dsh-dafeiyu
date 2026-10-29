import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ContextItemSchema} from '@dafeiyu/contracts';
import type {SourceDependency} from '@dafeiyu/contracts';
const record=z.object({owner:z.string(),region:z.string(),item:ContextItemSchema});
/** Parse only program-owned snapshots; labels never substitute for source authorization. */
export function snapshotItems(text:string):z.infer<typeof record>[]|null {try{const start=text.indexOf('{');if(start<0)return null;const raw:unknown=JSON.parse(text.slice(start));
  const native=z.object({kind:z.literal('native-context'),regions:z.array(record)}).safeParse(raw);if(native.success)return native.data.regions;
  const stage=z.object({kind:z.literal('stage-persona'),items:z.array(ContextItemSchema)}).safeParse(raw);if(stage.success)return stage.data.items.map(item=>({owner:'memory',region:'growth',item}));
  const controlled=z.object({schemaVersion:z.literal(1),regions:z.array(z.object({owner:z.string(),region:z.string(),items:z.array(ContextItemSchema)}))}).parse(raw);
  return controlled.regions.flatMap(region=>region.items.map(item=>({owner:region.owner,region:region.region,item})));}catch{return null;}}
export function validSnapshot(text:string,scope:{agentId:string;route:string},validate:(dependency:Extract<SourceDependency,{kind:'context'}>)=>boolean){try{const items=snapshotItems(text);return items!==null&&items.every(({owner,region,item})=>Date.parse(item.expiresAt)>Date.now()&&validate({...scope,kind:'context',owner,region,id:item.id,version:item.version,hash:createHash('sha256').update(JSON.stringify([item.text,item.sources])).digest('hex')}));}catch{return false;}}
export const SNAPSHOT_RULE='上下文快照按时间追加。每份快照完整描述当时的当前状态；同一模块以最后一份快照为当前状态，较早快照仅表示历史，不继续作为当前待办或当前偏好。空快照表示当前没有相应材料。已撤回或权限失效的材料不能继续使用。';
