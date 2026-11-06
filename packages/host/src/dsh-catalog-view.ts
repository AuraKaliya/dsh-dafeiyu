import {z} from 'zod';
import {orderedDshCatalog,redactJson} from '@dafeiyu/contracts';
import type {DshToolCatalog,Json} from '@dafeiyu/contracts';

export const DshCatalogQuerySchema=z.strictObject({
  kind:z.enum(['tools','skills']).default('tools'),
  name:z.string().min(1).max(160).optional(),
  query:z.string().max(100).optional(),
  offset:z.number().int().nonnegative().default(0),
  limit:z.number().int().min(1).max(20).default(12),
  maxChars:z.number().int().min(200).max(6000).default(4000),
  catalogVersion:z.string().length(64).optional(),
});

/** Only display data is paged/redacted. Execution still validates the original SDK schema and version. */
export function catalogView(raw:DshToolCatalog,input:z.infer<typeof DshCatalogQuerySchema>):Json {
  const catalog=orderedDshCatalog(raw);
  if(input.catalogVersion&&input.catalogVersion!==catalog.version)throw new Error('DSH_CATALOG_CHANGED');
  const rows=input.kind==='tools'?catalog.tools:catalog.skills??[];
  const common={version:catalog.version,kind:input.kind,total:rows.length,
    counts:{tools:catalog.tools.length,skills:catalog.skills?.length??0},skillsComplete:catalog.skillsComplete??true,
    ...(catalog.environment?{environment:redactJson(z.json().parse(catalog.environment)).value}:{})};
  if(input.name){
    const row=rows.find(item=>item.name===input.name);if(!row)throw new Error('DSH_CAPABILITY_NOT_FOUND');
    // Sanitize the complete object before slicing, including credential defaults/examples in host schemas.
    const safe=redactJson(z.json().parse(row)),chars=Array.from(JSON.stringify(safe.value));
    if(input.offset>chars.length)throw new Error('DSH_CATALOG_OFFSET_INVALID');
    const end=Math.min(chars.length,input.offset+input.maxChars);
    return {...common,name:input.name,format:'json-text',text:chars.slice(input.offset,end).join(''),offset:input.offset,
      totalChars:chars.length,redacted:safe.redacted,
      next:end<chars.length?{kind:input.kind,name:input.name,offset:end,maxChars:input.maxChars,catalogVersion:catalog.version}:null,
      note:'按 next 读取剩余 JSON 文字，不重新执行工具。redacted=true 时敏感字段已遮蔽，不能当作实际凭据。'};
  }
  const terms=input.query?.trim().toLocaleLowerCase().split(/\s+/u).filter(Boolean)??[];
  const selected=terms.length?rows.filter(row=>{const text=(row.name+' '+row.description).toLocaleLowerCase();return terms.every(term=>text.includes(term));}):rows;
  if(input.offset>selected.length)throw new Error('DSH_CATALOG_OFFSET_INVALID');
  const end=Math.min(selected.length,input.offset+input.limit);
  return redactJson(z.json().parse({...common,matched:selected.length,offset:input.offset,
    items:selected.slice(input.offset,end).map(row=>({name:row.name,description:Array.from(row.description).slice(0,160).join(''),
      read:{kind:input.kind,name:row.name,catalogVersion:catalog.version}})),
    next:end<selected.length?{kind:input.kind,...(input.query?{query:input.query}:{}),offset:end,limit:input.limit,catalogVersion:catalog.version}:null,
    note:'仅当前页名称与用途；用 read 查询精确参数或技能加载入口。目录可读不代表执行授权或外部依赖可用。'})).value;
}
