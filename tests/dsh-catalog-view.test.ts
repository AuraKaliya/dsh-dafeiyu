import test from 'node:test';
import assert from 'node:assert/strict';
import {z} from 'zod';
import {redactJson} from '@dafeiyu/contracts';
import {catalogView,DshCatalogQuerySchema} from '../packages/host/lib/dsh-catalog-view.js';

const catalog={version:'a'.repeat(64),tools:Array.from({length:180},(_,index)=>({name:'host_'+String(index).padStart(3,'0'),description:'实际用途。'.repeat(200),parameters:{type:'object',properties:{text:{type:'string',description:'详细说明'.repeat(1000)}},required:['text'],additionalProperties:false}}))};
const record=(value:unknown)=>z.record(z.string(),z.json()).parse(value);
test('large DSH catalogs page without losing any tool or returning oversized action results',()=>{
  assert.ok(Buffer.byteLength(JSON.stringify(catalog))>128000);
  const names:string[]=[];let query=DshCatalogQuerySchema.parse({});
  for(;;){const page=record(catalogView(catalog,query));assert.ok(Buffer.byteLength(JSON.stringify(page))<16000);
    assert.equal(redactJson(page).redacted,false);
    for(const item of z.array(z.object({name:z.string()})).parse(page.items))names.push(item.name);
    if(!page.next)break;query=DshCatalogQuerySchema.parse(page.next);
  }
  assert.equal(new Set(names).size,180);
  const filtered=record(catalogView(catalog,DshCatalogQuerySchema.parse({query:'host_179'})));assert.equal(filtered.matched,1);
  assert.throws(()=>catalogView(catalog,DshCatalogQuerySchema.parse({catalogVersion:'b'.repeat(64)})),/CATALOG_CHANGED/);
});
test('single-tool details reconstruct across pages after whole-object sanitization',()=>{
  let query=DshCatalogQuerySchema.parse({name:'host_000',maxChars:500}),text='';
  for(;;){const page=record(catalogView(catalog,query));text+=page.text;if(!page.next)break;query=DshCatalogQuerySchema.parse(page.next);}
  assert.deepEqual(JSON.parse(text),catalog.tools[0]);
  const sensitive={...catalog,tools:[{name:'auth_tool',description:'凭据由用户配置',parameters:{type:'object',properties:{password:{type:'string',default:'fictional-secret-never-emit'}}}}]};
  const page=catalogView(sensitive,DshCatalogQuerySchema.parse({name:'auth_tool'}));
  assert.doesNotMatch(JSON.stringify(page),/fictional-secret-never-emit/);
});
