import { z } from 'zod';

const safeNames=['Error','TypeError','RangeError','SyntaxError','AbortError','TimeoutError','AggregateError','LlmError'] as const;
const safeCodes=['TRANSPORT','TIMEOUT','ABORTED','ECONNRESET','ECONNREFUSED','EPIPE','ENOTFOUND','EAI_AGAIN','ETIMEDOUT','UND_ERR_SOCKET','UND_ERR_CONNECT_TIMEOUT','UND_ERR_HEADERS_TIMEOUT','UND_ERR_BODY_TIMEOUT','ERR_TLS_CERT_ALTNAME_INVALID','CERT_HAS_EXPIRED','UNABLE_TO_VERIFY_LEAF_SIGNATURE','DEPTH_ZERO_SELF_SIGNED_CERT','UNKNOWN'] as const;
export const TransportFactsSchema=z.array(z.strictObject({name:z.enum(safeNames),code:z.enum(safeCodes)})).max(8);
/** Explicit allowlists only. Messages, stacks, hostnames, sockets and headers never leave the live Error. */
export function transportFacts(error:unknown):z.infer<typeof TransportFactsSchema>{
  const result:z.infer<typeof TransportFactsSchema>=[],seen=new Set<unknown>(),pending=[error];
  while(pending.length&&result.length<8){const item=pending.shift();if(!item||typeof item!=='object'||seen.has(item))continue;seen.add(item);
    const name='name'in item?item.name:undefined,code='code'in item?item.code:undefined;
    const parsedName=z.enum(safeNames).safeParse(name),parsedCode=z.enum(safeCodes).safeParse(code);result.push({name:parsedName.success?parsedName.data:'Error',code:parsedCode.success?parsedCode.data:'UNKNOWN'});
    if('cause'in item)pending.push(item.cause);if(item instanceof AggregateError)pending.push(...item.errors.slice(0,8));
  }return result;
}
