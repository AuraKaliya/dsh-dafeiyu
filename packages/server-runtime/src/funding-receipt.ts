import { fundingBytesHash,fundingCheck } from './funding-config.js';

/** Hash the bounded original program receipt, not its normalized accounting projection.
 * No raw invalid value is persisted or included in an error message. */
export function fundingReceiptHash(value:unknown):string {
  let nodes=0;const visiting=new Set<object>();
  const encode=(part:unknown,depth:number):unknown=>{
    fundingCheck(++nodes<=256&&depth<=6,'FUNDING_RECEIPT_TOO_LARGE');
    if(part===null)return ['null'];
    if(part===undefined)return ['undefined'];
    if(typeof part==='number')return ['number',Object.is(part,-0)?'-0':String(part)];
    if(typeof part==='boolean')return ['boolean',part];
    if(typeof part==='string'){fundingCheck(part.length<=4096,'FUNDING_RECEIPT_TOO_LARGE');return ['string',part];}
    fundingCheck(typeof part==='object'&&part!==null&&!visiting.has(part),'FUNDING_RECEIPT_INVALID');
    const prototype=Object.getPrototypeOf(part);fundingCheck(Array.isArray(part)||prototype===Object.prototype||prototype===null,'FUNDING_RECEIPT_INVALID');visiting.add(part);
    try{
      const properties=Object.getOwnPropertyDescriptors(part),keys=Object.keys(properties).filter(key=>!Array.isArray(part)||key!=='length').sort();
      fundingCheck(keys.length<=64&&keys.every(key=>key.length<=200&&'value'in properties[key]!),'FUNDING_RECEIPT_INVALID');
      return [Array.isArray(part)?'array':'object',keys.map(key=>[key,encode(properties[key]!.value,depth+1)])];
    }finally{visiting.delete(part);}
  };
  const encoded=JSON.stringify(encode(value,0));fundingCheck(Buffer.byteLength(encoded)<=16384,'FUNDING_RECEIPT_TOO_LARGE');return fundingBytesHash(encoded);
}
