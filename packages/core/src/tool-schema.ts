import { z } from 'zod';
import { assertObjectJsonSchema } from '@deepseek-ai/dsh-tools';

/** DSH's wire vocabulary is smaller than JSON Schema. Zod remains the authoritative validator. */
function project(raw:unknown):Record<string,unknown>{
  const node=z.record(z.string(),z.unknown()).parse(raw),result:Record<string,unknown>={},bounds:Record<string,unknown>={};
  for(const [key,value] of Object.entries(node)){
    if(key==='$schema')continue;
    if(['minimum','maximum','exclusiveMinimum','exclusiveMaximum','minLength','maxLength','pattern','format','minItems','maxItems','multipleOf'].includes(key)){bounds[key]=value;continue;}
    if(key==='properties'){result[key]=Object.fromEntries(Object.entries(z.record(z.string(),z.unknown()).parse(value)).map(([name,child])=>[name,project(child)]));continue;}
    if(key==='items'){result[key]=project(value);continue;}
    if(key==='additionalProperties'&&typeof value==='object'){result[key]=true;continue;}
    if(key==='anyOf'||key==='oneOf'){
      const children=z.array(z.record(z.string(),z.unknown())).parse(value),types=children.map(child=>child.type);
      if(key==='anyOf'&&(types.some(type=>typeof type!=='string')||new Set(types).size!==types.length))throw new Error('V3_UNSUPPORTED_SCHEMA_UNION');
      result.oneOf=children.map(project);continue;
    }
    result[key]=value;
  }
  if(Object.keys(bounds).length)result.description=[result.description,`执行端约束：${JSON.stringify(bounds)}`].filter(Boolean).join('\n');
  return result;
}
export function toolParameters(raw:unknown){const result=project(raw);assertObjectJsonSchema(result);return result;}
