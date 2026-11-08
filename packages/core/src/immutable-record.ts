import type {SessionEvent} from '@deepseek-ai/dsh-session';
import type {ZodType} from 'zod';
function freeze<T>(value:T):T{if(value&&typeof value==='object'&&!Object.isFrozen(value)){Object.freeze(value);for(const child of Object.values(value))freeze(child);}return value;}
/** Cache decoding of SDK-frozen log records, never current source validity or authorization. */
export function immutableRecordReader<T>(schema:ZodType<T>){
  const decoded=new WeakMap<SessionEvent,T>();
  return (event:SessionEvent,raw:unknown):T=>{const prior=decoded.get(event);if(prior!==undefined)return prior;
    const value=schema.parse(raw);if(Object.isFrozen(event)){freeze(value);decoded.set(event,value);}return value;};
}
