import {createHash} from 'node:crypto';
import {ContextItemSchema} from '@dafeiyu/contracts';
import type {ContextContributor,ContextRequest,ContextItem,Conversation,Json,SourceDependency} from '@dafeiyu/contracts';

export interface ResponsibilityFact {id:string;version:string;data:Json;proof:Json;guard():void}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Required bounded index, not a replacement for authoritative Task records or full goals. */
export function situationContributor(enabled:()=>boolean,read:(scene:Conversation)=>readonly ResponsibilityFact[],
  record:(request:ContextRequest,item:ContextItem,proof:Json)=>void,
  historical:(request:ContextRequest,dependency:Extract<SourceDependency,{kind:'context'}>)=>boolean):ContextContributor {
  const views=new WeakMap<ContextRequest,Map<string,{hash:string;guard:()=>void}>>();
  return {id:'responsibilities',kind:'operational-fact',prepare:async request=>{
    if(!enabled())return [];const rows=read(request.conversation),map=new Map<string,{hash:string;guard:()=>void}>();
    const items=rows.slice(0,6).map(row=>{row.guard();const item=ContextItemSchema.parse({id:row.id,version:row.version,text:JSON.stringify(row.data),expiresAt:'9999-12-31T23:59:59.999Z',sources:[{ref:'dafeiyu:responsibility:'+row.id,version:row.version,hash:hash(row.data)}]});record(request,item,row.proof);map.set(item.id,{hash:hash(item),guard:row.guard});return item;});
    views.set(request,map);return items;
  },validate:(request,item)=>{const view=views.get(request)?.get(item.id);if(!view||view.hash!==hash(item))return false;try{view.guard();return true;}catch{return false;}},validateHistorical:historical};
}
