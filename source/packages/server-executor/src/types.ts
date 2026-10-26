import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ExecutionScopeSchema,PersonaRequestIdSchema } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';

export const ExecutorHashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const ExecutorCodeSchema=z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/);
const count=z.number().int().nonnegative().safe();
export const ExecutorIdentitySchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/)});
export const ExecutorTaskScopeSchema=ExecutionScopeSchema.transform((scope,context)=>{
  if(scope.kind!=='task'){context.addIssue({code:'custom',message:'Executor requires a native task scope'});return z.NEVER;}return scope;
});
export type ExecutorTaskScope=z.output<typeof ExecutorTaskScopeSchema>;

/** A durable description, never a transferable Core grant. Only the service may derive these hashes from live authority. */
export const ExecutorJobSpecSchema=z.strictObject({schemaVersion:z.literal(1),scope:ExecutorTaskScopeSchema,intentVersion:count.positive(),requestId:PersonaRequestIdSchema,
  authorizationKey:ExecutorHashSchema,goalHash:ExecutorHashSchema,inputHash:ExecutorHashSchema,profileHash:ExecutorHashSchema,commandHash:ExecutorHashSchema,executableHash:ExecutorHashSchema,
  budgetAuthorizationId:z.string().regex(/^[a-zA-Z0-9._:-]{1,120}$/)});
export type ExecutorJobSpec=z.infer<typeof ExecutorJobSpecSchema>;
/** Every actual operation keeps its full authorization fingerprint, including its Run/operation binding. */
export const ExecutorOperationBindingSchema=z.strictObject({runId:z.uuid(),operationId:z.uuid(),authorizationHash:ExecutorHashSchema});
export type ExecutorOperationBinding=z.infer<typeof ExecutorOperationBindingSchema>;
export const ExecutorProcessSchema=z.strictObject({pid:count.positive(),creationId:z.string().min(1).max(160),executableHash:ExecutorHashSchema});
export type ExecutorProcess=z.infer<typeof ExecutorProcessSchema>;
export const ExecutorHandshakeSchema=z.strictObject({nonceHash:ExecutorHashSchema,profileHash:ExecutorHashSchema,process:ExecutorProcessSchema});
export type ExecutorHandshake=z.infer<typeof ExecutorHandshakeSchema>;
export const ExecutorStateSchema=z.enum(['prepared','launching','running','completed','failed','cancelled','unknown']);
export type ExecutorState=z.infer<typeof ExecutorStateSchema>;
export const ExecutorOutputSchema=z.strictObject({relative:z.string().regex(/^[a-zA-Z0-9._/-]{1,300}$/).refine(path=>path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..')),
  hash:ExecutorHashSchema,bytes:count.max(64*1024*1024)});
export const ExecutorExitSchema=z.strictObject({code:z.number().int().safe().nullable(),signal:z.string().regex(/^SIG[A-Z0-9]{1,20}$/).nullable(),verified:z.boolean()})
  .refine(exit=>exit.code!==null||exit.signal!==null,'A verified exit needs a code or signal');
export const ExecutorTerminalSchema=z.strictObject({state:z.enum(['completed','failed','cancelled','unknown']),effects:z.enum(['none','confirmed','unknown']),
  sessionId:z.string().min(1).max(300).nullable(),exit:ExecutorExitSchema.nullable(),output:ExecutorOutputSchema.nullable(),gaps:z.array(ExecutorCodeSchema).max(32)})
  .superRefine((value,context)=>{
    if((value.state==='unknown')!==(value.effects==='unknown'))context.addIssue({code:'custom',message:'Unknown effects must retain an unknown job state'});
    if(value.state==='unknown'&&value.gaps.length===0)context.addIssue({code:'custom',message:'Unknown jobs require a stable diagnostic gap'});
    if(value.state==='completed'&&(!value.exit?.verified||value.exit.code!==0||value.exit.signal!==null||!value.output||!value.sessionId))context.addIssue({code:'custom',message:'Completion requires a verified zero exit and a sealed visible result'});
  });
export type ExecutorTerminal=z.infer<typeof ExecutorTerminalSchema>;
export const ExecutorReceiptSchema=ExecutorTerminalSchema.safeExtend({schemaVersion:z.literal(1),id:z.uuid(),jobId:z.uuid(),createdAt:z.iso.datetime(),
  nonceHash:ExecutorHashSchema.nullable(),process:ExecutorProcessSchema.nullable()});
export type ExecutorReceipt=z.infer<typeof ExecutorReceiptSchema>;
export const ExecutorReceiptRefSchema=z.strictObject({id:z.uuid(),hash:ExecutorHashSchema});

const eventFields={schemaVersion:z.literal(1),id:z.uuid(),jobId:z.uuid(),version:count.positive(),at:z.iso.datetime()};
export const ExecutorEventSchema=z.discriminatedUnion('type',[
  z.strictObject({...eventFields,type:z.literal('prepared'),requestHash:ExecutorHashSchema}),
  z.strictObject({...eventFields,type:z.literal('launching'),nonceHash:ExecutorHashSchema}),
  z.strictObject({...eventFields,type:z.literal('running'),handshake:ExecutorHandshakeSchema}),
  z.strictObject({...eventFields,type:z.literal('cancel-requested'),code:ExecutorCodeSchema}),
  z.strictObject({...eventFields,type:z.literal('terminal'),receipt:ExecutorReceiptRefSchema}),
]);
export type ExecutorEvent=z.infer<typeof ExecutorEventSchema>;
export interface StoredExecutorJob {readonly id:string;readonly spec:ExecutorJobSpec;readonly hash:string;readonly state:ExecutorState;readonly version:number;readonly nonceHash:string|null;
  readonly process:ExecutorProcess|null;readonly cancelRequested:boolean;readonly createdAt:string;readonly updatedAt:string;readonly receipt:ExecutorReceipt|null}

function canonical(value:Json):string {
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key]!)).join(',')+'}';
}
export const executorHash=(value:unknown):string=>createHash('sha256').update(canonical(z.json().parse(value))).digest('hex');
