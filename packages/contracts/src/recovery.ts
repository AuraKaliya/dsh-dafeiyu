import {z} from 'zod';

/** Trusted management input. A probe checks one current failure generation. */
export const RecoveryProbeRequestSchema=z.strictObject({requestId:z.uuid(),expectedGeneration:z.number().int().positive()});
export type RecoveryProbeRequest=z.infer<typeof RecoveryProbeRequestSchema>;
export const MediaRecoveryRequestSchema=RecoveryProbeRequestSchema.extend({key:z.string().min(1).max(1000)});
export interface DependencyRecovery {key:string;generation:number;state:'blocked'|'retry-ready'|'recovered';code:string}
