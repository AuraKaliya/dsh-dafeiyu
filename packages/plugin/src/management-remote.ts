import type {TypertRemoteContribution} from '@deepseek-ai/dsh-typert-protocol';
import {z} from 'zod';
const requestPayload={mode:'strict' as const,typeSymbol:'dsh-dafeiyu#dafeiyuManagement/request:payload',create:()=>z.string(),jsonSchema:{type:'string'}};
export const managementRemote:TypertRemoteContribution={package:'dsh-dafeiyu',descriptors:[{id:'dsh-dafeiyu#dafeiyuManagement/request',service:'dafeiyuManagement',namespace:'dafeiyuManagement',method:'request',invocation:{kind:'direct'},parameters:[{name:'payload',wire:'payload',source:'json',codec:requestPayload}],result:requestPayload}]};
