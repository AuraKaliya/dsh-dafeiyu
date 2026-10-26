import { closeSync,existsSync,fstatSync,fsyncSync,lstatSync,openSync,readSync,renameSync,unlinkSync,writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { z } from 'zod';
import type { BigIntStats } from 'node:fs';
import type { HostSnapshot } from '@dafeiyu/host';
import type { WindowsHostProof } from '@dafeiyu/server-executor/windows-process';
import { runtimeBytesHash,runtimeCheck,runtimeFreeze,runtimeDigest,runtimePathIdentity } from './runtime-files.js';
import { RuntimeIdentitySchema } from './types.js';

export const SERVER_RUNTIME_STATUS_FILE='server-runtime-status.json';
export const SERVER_RUNTIME_STATUS_MAX_BYTES=32768;
const hash=z.string().regex(/^[a-f0-9]{64}$/),count=z.number().int().nonnegative().safe(),code=z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/);
export const ServerRuntimeStatusIdentitySchema=z.strictObject({profileId:RuntimeIdentitySchema,agentId:RuntimeIdentitySchema,accountingId:RuntimeIdentitySchema,manifestHash:hash,configHash:hash});
export type ServerRuntimeStatusIdentity=z.infer<typeof ServerRuntimeStatusIdentitySchema>;
export const ServerRuntimeParentProofSchema=z.strictObject({pid:count.positive().max(2147483647),creationId:z.string().regex(/^[1-9]\d{0,19}$/),nodeHash:hash,ownerSid:z.string().regex(/^S-1-(?:\d+-){1,14}\d+$/).max(184),observedAt:z.iso.datetime()});
export type ServerRuntimeParentProof=z.infer<typeof ServerRuntimeParentProofSchema>;
export const ServerRuntimeHostStateSchema=z.strictObject({instanceId:z.uuid().nullable(),observedAt:z.iso.datetime(),phase:z.enum(['created','inspected','opening','binding','recovering','ready','degraded','draining','failed','stopped']),accepting:z.boolean(),
  counts:z.strictObject({activeRuns:count,queuedRuns:count,queuedRoutes:count,pendingMessages:count,outbox:count})});
export type ServerRuntimeHostState=z.infer<typeof ServerRuntimeHostStateSchema>;
export const ServerRuntimeStopSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('accounting-stop'),code,reason:z.enum(['unknown-cost','expired','exhausted','clock-stop'])}),
  z.strictObject({kind:z.literal('runtime-failure'),code}),
  z.strictObject({kind:z.literal('requested'),code}),
]);
export type ServerRuntimeStop=z.infer<typeof ServerRuntimeStopSchema>;
const state=z.enum(['starting','running','stopping','stopped','failed']);
export const ServerRuntimeStatusInputSchema=z.strictObject({state,host:ServerRuntimeHostStateSchema.nullable(),parentProof:ServerRuntimeParentProofSchema.nullable(),stop:ServerRuntimeStopSchema.nullable(),
  closure:z.strictObject({drained:z.boolean(),proof:z.enum(['not-created','open','closed','unconfirmed'])})});
export type ServerRuntimeStatusInput=z.infer<typeof ServerRuntimeStatusInputSchema>;
export const ServerRuntimeStatusSchema=ServerRuntimeStatusInputSchema.extend({...ServerRuntimeStatusIdentitySchema.shape,schemaVersion:z.literal(1),directoryIdentity:hash,writerId:z.uuid(),writerPid:count.positive(),sequence:count.positive(),at:z.iso.datetime(),clockRegressed:z.boolean()})
  .superRefine((value,ctx)=>{
    const fail=(message:string)=>ctx.addIssue({code:'custom',message});
    if(value.clockRegressed&&!(value.stop?.kind==='accounting-stop'&&value.stop.reason==='clock-stop'))fail('Clock regression must remain an explicit terminal accounting fact');
    if(value.parentProof&&(value.parentProof.pid!==value.writerPid||!value.clockRegressed&&Date.parse(value.parentProof.observedAt)>Date.parse(value.at)))fail('Parent identity/time must belong to the recorded writer');
    if(value.host&&!value.clockRegressed&&Date.parse(value.host.observedAt)>Date.parse(value.at))fail('Host observation cannot be in the future');
    if(value.closure.proof==='not-created'&&value.parentProof!==null||['open','closed'].includes(value.closure.proof)&&value.parentProof===null)fail('Proof state contradicts its recorded identity');
    if(value.state==='running'&&(!value.host||!value.parentProof||value.closure.proof!=='open'))fail('Running requires an observed Host and owned proof resource');
    if(['starting','running'].includes(value.state)&&(value.stop!==null||value.closure.drained))fail('Active states cannot claim a terminal stop or completed drain');
    if(['stopping','stopped','failed'].includes(value.state)&&value.stop===null)fail('A stop must keep its stable cause');
    if(value.closure.drained&&(!['stopped','failed'].includes(value.state)||!['closed','not-created'].includes(value.closure.proof)||value.host?.accepting))fail('Drain needs final state, closed proof ownership and closed ingress');
    if(value.state==='stopped'&&!value.closure.drained)fail('Stopped requires an actually completed close');
  });
export type ServerRuntimeStatus=z.infer<typeof ServerRuntimeStatusSchema>;
export interface ServerRuntimeStatusWriterOptions extends ServerRuntimeStatusIdentity {readonly coreDir:string}
export type ServerRuntimeStatusRead={readonly kind:'missing'|'invalid';readonly live:'unverified';readonly fresh:false;readonly code:string}
  |{readonly kind:'snapshot';readonly live:'unverified';readonly fresh:boolean;readonly code:string|null;readonly ageMs:number;readonly hostAgeMs:number|null;
    readonly snapshot:ServerRuntimeStatus;readonly token:{readonly writerId:string;readonly sequence:number;readonly hash:string};readonly accountingStopped:boolean;readonly recordedAccountingStopReceipt:boolean};

/** Select program metadata only; this projection itself does not authenticate a copied proof. */
export function projectServerRuntimeParentProof(proof:WindowsHostProof):ServerRuntimeParentProof {
  return runtimeFreeze(ServerRuntimeParentProofSchema.parse({pid:proof.parent.pid,creationId:proof.parent.creationId,nodeHash:proof.parent.executableHash,ownerSid:proof.parent.ownerSid,observedAt:proof.observedAt}));
}
export function projectServerRuntimeHost(snapshot:HostSnapshot):ServerRuntimeHostState {
  return runtimeFreeze(ServerRuntimeHostStateSchema.parse({instanceId:snapshot.instanceId==='00000000-0000-4000-8000-000000000000'?null:snapshot.instanceId,observedAt:snapshot.at,phase:snapshot.phase,accepting:snapshot.accepting,counts:snapshot.counts}));
}
function statusError(error:unknown,fallback='SERVER_RUNTIME_STATUS_INVALID'):string {
  return error instanceof Error&&/^SERVER_RUNTIME_STATUS_[A-Z0-9_]+$/.test(error.message)?error.message:fallback;
}
function directoryIdentity(coreDir:string):string {
  try{return runtimePathIdentity(coreDir,'directory');}catch{throw new Error('SERVER_RUNTIME_STATUS_DIRECTORY_INVALID');}
}
function check(value:unknown,name:string):asserts value {runtimeCheck(value,'SERVER_RUNTIME_STATUS_'+name);}
function identityFields(value:ServerRuntimeStatusIdentity):ServerRuntimeStatusIdentity {return {profileId:value.profileId,agentId:value.agentId,accountingId:value.accountingId,manifestHash:value.manifestHash,configHash:value.configHash};}
function processFields(value:ServerRuntimeParentProof){return {pid:value.pid,creationId:value.creationId,nodeHash:value.nodeHash,ownerSid:value.ownerSid};}
interface LoadedStatus {readonly snapshot:ServerRuntimeStatus;readonly hash:string}
function readExisting(file:string,expectedDirectory:string):LoadedStatus|null {
  let before:BigIntStats;
  try{before=lstatSync(file,{bigint:true});}catch(error){if(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT')return null;throw new Error('SERVER_RUNTIME_STATUS_READ_FAILED');}
  check(before.isFile()&&!before.isSymbolicLink()&&before.nlink===1n,'PATH_INVALID');check(before.size>0n&&before.size<=BigInt(SERVER_RUNTIME_STATUS_MAX_BYTES),'SIZE_INVALID');
  const descriptor=openSync(file,'r');
  try{
    const opened=fstatSync(descriptor,{bigint:true});check(opened.dev===before.dev&&opened.ino===before.ino&&opened.isFile()&&opened.nlink===1n,'PATH_CHANGED');
    const bytes=Buffer.alloc(SERVER_RUNTIME_STATUS_MAX_BYTES+1);let length=0,received=0;
    do{received=readSync(descriptor,bytes,length,bytes.length-length,null);length+=received;}while(received>0&&length<bytes.length);
    check(length>0&&length<=SERVER_RUNTIME_STATUS_MAX_BYTES,'SIZE_INVALID');
    const after=fstatSync(descriptor,{bigint:true}),named=lstatSync(file,{bigint:true});
    check(!named.isSymbolicLink()&&named.nlink===1n&&after.dev===opened.dev&&after.ino===opened.ino&&named.dev===opened.dev&&named.ino===opened.ino&&after.size===BigInt(length)&&after.size===opened.size&&after.mtimeNs===opened.mtimeNs,'PATH_CHANGED');
    const body=bytes.subarray(0,length),snapshot=ServerRuntimeStatusSchema.parse(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body)) as unknown);
    check(snapshot.directoryIdentity===expectedDirectory,'DIRECTORY_CHANGED');return {snapshot:runtimeFreeze(snapshot),hash:runtimeBytesHash(body)};
  }finally{closeSync(descriptor);}
}

/** Read-only and bounded. Freshness is not OS liveness, lease ownership or health proof. */
export function readServerRuntimeStatus(coreDir:string,expected:ServerRuntimeStatusIdentity,options:{maxAgeMs:number;now?:number}):ServerRuntimeStatusRead {
  try{
    const identity=ServerRuntimeStatusIdentitySchema.parse(expected),now=options.now??Date.now();count.parse(now);z.number().int().min(1).max(3600000).parse(options.maxAgeMs);
    const directory=directoryIdentity(coreDir),loaded=readExisting(join(coreDir,SERVER_RUNTIME_STATUS_FILE),directory);check(directoryIdentity(coreDir)===directory,'DIRECTORY_CHANGED');
    if(!loaded)return {kind:'missing',live:'unverified',fresh:false,code:'SERVER_RUNTIME_STATUS_MISSING'};
    const {snapshot}=loaded;check(runtimeDigest(identityFields(snapshot))===runtimeDigest(identity),'IDENTITY_MISMATCH');
    const ageMs=now-Date.parse(snapshot.at),hostAgeMs=snapshot.host?now-Date.parse(snapshot.host.observedAt):null,
      future=ageMs<0||hostAgeMs!==null&&hostAgeMs<0,stale=ageMs>options.maxAgeMs||hostAgeMs!==null&&hostAgeMs>options.maxAgeMs;
    const accountingStopped=snapshot.stop?.kind==='accounting-stop';
    return {kind:'snapshot',live:'unverified',fresh:!snapshot.clockRegressed&&!future&&!stale,code:snapshot.clockRegressed?'SERVER_RUNTIME_STATUS_CLOCK_REGRESSED':future?'SERVER_RUNTIME_STATUS_FUTURE':stale?'SERVER_RUNTIME_STATUS_STALE':null,ageMs,hostAgeMs,snapshot,
      token:{writerId:snapshot.writerId,sequence:snapshot.sequence,hash:loaded.hash},accountingStopped,recordedAccountingStopReceipt:accountingStopped&&snapshot.closure.drained&&['stopped','failed'].includes(snapshot.state)&&['closed','not-created'].includes(snapshot.closure.proof)};
  }catch(error){return {kind:'invalid',live:'unverified',fresh:false,code:statusError(error)};}
}

/** Requires the launcher's existing accounting/profile ownership; this is not a second runtime lease.
 * Synchronous compare-before-replace rejects stale callbacks. The caller must serialize different processes. */
export class ServerRuntimeStatusWriter {
  readonly file:string;
  private readonly directory:string;private readonly coreDir:string;private readonly identity:ServerRuntimeStatusIdentity;private readonly writerId=randomUUID();
  private previous:LoadedStatus|null;private own:ServerRuntimeStatus|null=null;
  constructor(options:ServerRuntimeStatusWriterOptions){
    const {coreDir,...identity}=options;this.identity=runtimeFreeze(ServerRuntimeStatusIdentitySchema.parse(identity));this.coreDir=coreDir;this.directory=directoryIdentity(coreDir);this.file=join(coreDir,SERVER_RUNTIME_STATUS_FILE);
    this.previous=readExisting(this.file,this.directory);if(this.previous)check(this.previous.snapshot.profileId===identity.profileId&&this.previous.snapshot.agentId===identity.agentId,'IDENTITY_MISMATCH');
    this.ownerCheck();
  }
  private ownerCheck(){check(directoryIdentity(this.coreDir)===this.directory,'DIRECTORY_CHANGED');const current=readExisting(this.file,this.directory);check(current?.hash===this.previous?.hash,'WRITER_CHANGED');}
  write(raw:ServerRuntimeStatusInput,now=Date.now()):ServerRuntimeStatus {
    let input:ServerRuntimeStatusInput;try{input=ServerRuntimeStatusInputSchema.parse(raw);count.parse(now);}catch{throw new Error('SERVER_RUNTIME_STATUS_INPUT_INVALID');}this.ownerCheck();
    const previous=this.own;
    const clockStop=input.stop?.kind==='accounting-stop'&&input.stop.reason==='clock-stop';
    if(previous){
      check(clockStop||now>=Date.parse(previous.at),'CLOCK_MOVED_BACKWARDS');
      if(previous.closure.drained){
        const priorInput={state:previous.state,host:previous.host,parentProof:previous.parentProof,stop:previous.stop,closure:previous.closure};
        check(runtimeDigest(priorInput)===runtimeDigest(input),'FINALIZED');return previous;
      }
      check(input.state!=='starting'||previous.state==='starting','TRANSITION_INVALID');
      check(input.state!=='running'||['starting','running'].includes(previous.state),'TRANSITION_INVALID');
      if(previous.parentProof)check(input.parentProof!==null&&runtimeDigest(processFields(input.parentProof))===runtimeDigest(processFields(previous.parentProof))&&Date.parse(input.parentProof.observedAt)>=Date.parse(previous.parentProof.observedAt),'PROCESS_CHANGED');
      if(previous.host?.instanceId&&input.host?.instanceId)check(previous.host.instanceId===input.host.instanceId,'HOST_INSTANCE_CHANGED');
    }
    check(clockStop||this.previous===null||now>=Date.parse(this.previous.snapshot.at),'CLOCK_MOVED_BACKWARDS');
    const clockRegressed=previous?.clockRegressed===true||clockStop&&(this.previous!==null&&now<Date.parse(this.previous.snapshot.at)||input.parentProof!==null&&Date.parse(input.parentProof.observedAt)>now||input.host!==null&&Date.parse(input.host.observedAt)>now);
    let snapshot:ServerRuntimeStatus;
    try{snapshot=runtimeFreeze(ServerRuntimeStatusSchema.parse({...input,...this.identity,schemaVersion:1,directoryIdentity:this.directory,writerId:this.writerId,writerPid:process.pid,sequence:(this.previous?.snapshot.sequence??0)+1,at:new Date(now).toISOString(),clockRegressed}));}
    catch{throw new Error('SERVER_RUNTIME_STATUS_INPUT_INVALID');}
    const bytes=Buffer.from(JSON.stringify(snapshot)+'\n');check(bytes.length<=SERVER_RUNTIME_STATUS_MAX_BYTES,'SIZE_INVALID');
    const temporary=join(this.coreDir,`.server-runtime-status.${this.writerId}.${snapshot.sequence}.tmp`);let temporaryIdentity:{dev:bigint;ino:bigint}|undefined,renamed=false;
    try{
      const descriptor=openSync(temporary,'wx',0o600);
      try{const info=fstatSync(descriptor,{bigint:true});temporaryIdentity={dev:info.dev,ino:info.ino};writeFileSync(descriptor,bytes);fsyncSync(descriptor);}finally{closeSync(descriptor);}
      this.ownerCheck();renameSync(temporary,this.file);renamed=true;
      const actual=readExisting(this.file,this.directory);check(actual?.hash===runtimeBytesHash(bytes),'WRITE_UNCONFIRMED');
      this.previous=actual;this.own=snapshot;return snapshot;
    }catch(error){throw new Error(statusError(error,'SERVER_RUNTIME_STATUS_WRITE_FAILED'));}
    finally{
      if(!renamed&&temporaryIdentity&&directoryIdentity(this.coreDir)===this.directory&&existsSync(temporary)){
        const info=lstatSync(temporary,{bigint:true});if(info.isFile()&&!info.isSymbolicLink()&&info.nlink===1n&&info.dev===temporaryIdentity.dev&&info.ino===temporaryIdentity.ino)unlinkSync(temporary);
      }
    }
  }
}
