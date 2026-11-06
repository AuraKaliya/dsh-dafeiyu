import {z} from 'zod';

/** Trusted management input. A probe checks one current failure generation. */
export const RecoveryProbeRequestSchema=z.strictObject({requestId:z.uuid(),expectedGeneration:z.number().int().positive()});
export type RecoveryProbeRequest=z.infer<typeof RecoveryProbeRequestSchema>;
export const MediaRecoveryRequestSchema=RecoveryProbeRequestSchema.extend({key:z.string().min(1).max(1000)});
export interface DependencyRecovery {key:string;generation:number;state:'blocked'|'retry-ready'|'recovered';code:string}

export interface ModelFailureFacts {readonly code:string;readonly status?:number;readonly providerRetryAfterMs?:number}
/** Retry transport/rate-limit outages, never account or configuration failures. */
export const transientModelFailure=(failure:ModelFailureFacts)=>failure.status===undefined?['TRANSPORT','CONNECTION_ERROR','NETWORK_ERROR','TIMEOUT','MESSAGES_IDLE'].includes(failure.code):[429,502,503,504].includes(failure.status);
export function modelRetryDelay(failure:ModelFailureFacts,attempt:number){const requested=failure.providerRetryAfterMs;return Math.max(750*2**attempt,typeof requested==='number'&&Number.isFinite(requested)&&requested>0?requested:0);}
