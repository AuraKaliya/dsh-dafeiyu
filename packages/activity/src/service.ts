import {RELEASE_VERSION} from '@dafeiyu/contracts';
import {RecoveryProbeRequestSchema} from '@dafeiyu/contracts';
import {API_VERSION} from '@dafeiyu/contracts';
import {pendingActivityEvents} from './storage-status.js';
import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/core';
import { join } from 'node:path';
import { z } from 'zod';
import { ActivityConfigSchema,ActivityTriggerSchema,ActivityPlanReceiptSchema,ACTIVITY_PLAN_COMPLETION_RULE,QuietWindowSchema,ActivityTimeZoneSchema,PersonaSourceRefSchema,PersonaRequestIdSchema,ServiceGate,GroupWatchSchema } from '@dafeiyu/contracts';
import type { ActionCapability,ExecutionContext,PersonaSourceRef,ActivityScheduleBody,MemoryMaintenanceSchedulingPort,ActivityDomainEvent } from '@dafeiyu/contracts';
import { ActivityStore,activityHash } from './store.js';
import type {StoredSchedule} from './store.js';
import { ActivityScheduler } from './scheduler.js';

const trigger=z.discriminatedUnion('kind',[
  ActivityTriggerSchema.options[0],ActivityTriggerSchema.options[1],
  z.strictObject({kind:z.literal('condition'),event:z.enum(['task-settled','memory-pending'])}),
]);
const planSchema=z.strictObject({requestId:PersonaRequestIdSchema,goal:z.string().trim().min(1).max(2000),basis:z.array(PersonaSourceRefSchema).max(8).default([]),
  kind:z.enum(['exploration','group-watch']).default('exploration'),watch:GroupWatchSchema.optional(),
  trigger,missed:z.enum(['skip','coalesce','run-once']).default('coalesce'),quiet:z.array(QuietWindowSchema).max(8).optional(),timeZone:ActivityTimeZoneSchema.optional()});
const updateSchema=z.strictObject({id:z.uuid(),requestId:PersonaRequestIdSchema,expectedVersion:z.number().int().positive(),
  state:z.enum(['active','paused','cancelled']).optional(),trigger:trigger.optional(),missed:z.enum(['skip','coalesce','run-once']).optional(),
  quiet:z.array(QuietWindowSchema).max(8).optional(),timeZone:ActivityTimeZoneSchema.optional(),goal:z.string().trim().min(1).max(2000).optional(),basis:z.array(PersonaSourceRefSchema).max(8).optional()})
  .refine(v=>[v.state,v.trigger,v.missed,v.quiet,v.timeZone,v.goal,v.basis].some(value=>value!==undefined),'Empty activity update');
export const configSchema=z.strictObject({agentId:z.string().min(1).max(100),profileId:z.string().min(1).max(100),dataDir:z.string().min(1),settings:ActivityConfigSchema.prefault({})});
export type Config=z.input<typeof configSchema>;
declare module '@deepseek-ai/cordis' {interface Context {dafeiyuActivity:ActivityService}}
export const ACTIVITY_ACTIONS=['dafeiyu_activity_plan','dafeiyu_activity_update','dafeiyu_activity_status','dafeiyu_activity_rest'] as const;

export class ActivityService extends Service {
  management(action:string,raw:unknown){if(action==='recovery.probe')return this.scheduler.probeRecovery(RecoveryProbeRequestSchema.parse(raw));if(action==='plan.update'){const input=z.strictObject({id:z.uuid(),requestId:z.uuid(),expectedVersion:z.number().int().positive(),state:z.enum(['active','paused','cancelled'])}).parse(raw),plan=this.store.get(input.id);return this.store.update(input.id,plan.body.owner,{requestId:input.requestId,expectedVersion:input.expectedVersion,state:input.state},this.now());}if(action==='configure-budget')return this.store.rounds.configure(raw);if(action!=='status')throw new Error('MANAGEMENT_ACTION_INVALID');return {health:this.health,settings:this.config.settings,plans:this.store.management().map(plan=>this.statusView(plan)),rounds:this.store.rounds.list(),admission:this.store.admission.gates(),explorations:this.store.admission.list().slice(0,20),recovery:this.scheduler.recoveryStatus()};}
  pendingEvents(){return pendingActivityEvents(this.config.dataDir); }
  readonly store:ActivityStore;
  readonly config:z.output<typeof configSchema>;
  readonly configHash:string;
  private readonly gate=new ServiceGate();
  private closed=false;
  private closing:Promise<void>|undefined;
  private finalCounts:ReturnType<ActivityStore['counts']>|undefined;
  private readonly scheduler:ActivityScheduler;
  private readonly handle:ReturnType<Context['dafeiyu']['registerExtension']>;
  constructor(ctx:Context,raw:Config,private readonly now:()=>number=Date.now,monotonic:()=>number=()=>performance.now()){
    super(ctx,'dafeiyuActivity');this.config=configSchema.parse(raw);this.configHash=activityHash(this.config.settings);
    this.store=new ActivityStore(join(this.config.dataDir,'activity.sqlite'),{agentId:this.config.agentId,profileId:this.config.profileId},this.config.settings);
    try{this.handle=ctx.dafeiyu.registerExtension({protocolVersion:API_VERSION,id:'activity',version:RELEASE_VERSION,agentId:this.config.agentId,
      requires:['execution.task.v1','execution.source-anchor.v1','memory.execution.v1',...(this.config.settings.maintenance?['memory.maintenance.v1']:[])],provides:['activity.plan.v1','activity.wakeup.v1'],lifecycleReady:()=>this.gate.active&&!this.closed&&this.scheduler.dependenciesReady(),actions:this.actions(),
      contexts:[{id:'wake',prepare:async view=>this.scheduler.context(view),validate:(view,item)=>this.scheduler.contextCurrent(view,item)}]});}
    catch(error){this.store.close();throw error;}
    try{this.scheduler=new ActivityScheduler(ctx,this.store,this.configHash,()=>this.gate.active&&!this.closed,this.now,monotonic);}catch(error){this.handle.dispose();this.store.close();throw error;}
    const releaseSharing=ctx.dafeiyu.bindActivitySharing(()=>({enabled:this.gate.active&&!this.closed&&this.config.settings.ownerSharing.enabled,cooldownMs:this.config.settings.ownerSharing.cooldownMs}));ctx.effect(()=>releaseSharing,'activity.sharing');
    const releasePatrol=ctx.dafeiyu.bindPatrolValidator((id,version,target,reply)=>{try{const plan=this.store.get(id);return this.gate.active&&!this.closed&&plan.status==='active'&&plan.body.version===version&&plan.body.purpose==='group-watch'&&!!plan.body.watch&&(!reply||plan.body.watch.reply)&&!!plan.body.anchor&&ctx.dafeiyu.patrolResources(plan.body.anchor).some(scene=>activityHash(scene)===activityHash(target))&&(plan.body.watch.mode==='joined'||plan.body.watch.groupIds.includes(target.id));}catch{return false;}});ctx.effect(()=>releasePatrol,'activity.patrol');
    ctx.effect(()=>()=>this.close(),'activity.close');
  }
  private access(context:ExecutionContext,write:boolean){if(this.closed)throw new Error('DEPENDENCY_UNAVAILABLE');this.gate.assertActive();
    const access=this.ctx.dafeiyu.personaAccess(context,'activity',write?'local-write':'read');if(access.view.scope.kind!=='task')throw new Error('TASK_REQUIRED');return access;}
  private basis(context:ExecutionContext,refs:readonly PersonaSourceRef[]){const access=this.access(context,true),exposed=[...access.admittedSources,...access.inputs.flatMap(i=>i.sourceRef?[i.sourceRef]:[])];
    if(refs.some(ref=>!exposed.some(item=>activityHash(item)===activityHash(ref))))throw new Error('SOURCE_NOT_EXPOSED');return access;}
  private trigger(context:ExecutionContext,value:z.infer<typeof trigger>):ActivityScheduleBody['trigger']{
    return value.kind==='condition'?{...value,key:`task:${context.taskId}`}:value;
  }
  private receipt(value:{id:string;version:number}){const body=this.store.snapshot(value.id,value.version);
    return ActivityPlanReceiptSchema.parse({...value,purpose:body.purpose,state:body.state,trigger:body.trigger.kind==='condition'?{kind:body.trigger.kind,event:body.trigger.event}:body.trigger,
      timeZone:body.timeZone,quiet:body.quiet,...(body.watch?{watch:{mode:body.watch.mode,reply:body.watch.reply}}:{}),recordedAt:body.updatedAt,
      activationPolicy:{sourceTaskMustSettle:true,foregroundMustBeIdle:true,evidence:'configuration-only',note:ACTIVITY_PLAN_COMPLETION_RULE}});}
  plan(context:ExecutionContext,raw:unknown){const input=planSchema.parse(raw),access=this.basis(context,input.basis),anchor=this.ctx.dafeiyu.captureActivityAnchor(context,'activity');
    if(input.kind==='group-watch'&&(!input.watch||!this.ctx.dafeiyu.isOwnerExecution(context,'activity')||input.watch.reply&&!this.ctx.dafeiyu.patrolReplyPermitted(context)))throw new Error('PATROL_AUTHORIZATION_REQUIRED');
    return this.receipt(this.store.create({schemaVersion:1,requestId:input.requestId,agentId:this.config.agentId,owner:access.view.scope,purpose:input.kind,...(input.watch?{watch:input.watch}:{}),goal:input.goal,basis:input.basis,anchor,maintenanceId:null,
      policyId:this.config.settings.explorationPolicy,configHash:this.configHash,trigger:this.trigger(context,input.trigger),missed:input.missed,
      timeZone:input.timeZone??this.config.settings.timeZone,quiet:input.quiet??this.config.settings.quiet,state:'active'},this.now()));
  }
  update(context:ExecutionContext,raw:unknown){const input=updateSchema.parse(raw),access=this.basis(context,input.basis??[]),ownerControl=this.ctx.dafeiyu.isOwnerExecution(context,'activity'),plan=this.store.get(input.id,ownerControl?undefined:access.view.scope);
    if(plan.body.purpose==='maintenance'&&(input.goal!==undefined||input.basis!==undefined))throw new Error('SCOPE_DENIED');
    const pauseOnly=(input.state==='paused'||input.state==='cancelled')&&input.goal===undefined&&input.basis===undefined&&input.trigger===undefined&&input.missed===undefined&&input.quiet===undefined&&input.timeZone===undefined;
    if(!pauseOnly&&plan.body.anchor&&this.ctx.dafeiyu.activityAnchorStatus(plan.body.anchor).state==='stale'&&input.goal===undefined)throw new Error('ACTIVITY_REPLAN_REQUIRED');
    const anchor=pauseOnly?undefined:this.ctx.dafeiyu.captureActivityAnchor(context,'activity');const {id,...patch}=input;
    return this.receipt(this.store.update(id,ownerControl?plan.body.owner:access.view.scope,{...patch,...(input.goal!==undefined?{basis:input.basis??[]}:{}),...(input.trigger?{trigger:this.trigger(context,input.trigger)}:{}),...(anchor?{anchor,...(ownerControl?{owner:access.view.scope}:{})}:{}),configHash:this.configHash},this.now()));
  }
  status(context:ExecutionContext,id?:string){
    if(this.ctx.dafeiyu.isOwnerExecution(context,'activity'))return id?this.statusView(this.store.get(id),context.runId):{health:this.health,settings:this.config.settings,plans:this.store.management().map(plan=>this.statusView(plan,context.runId)),rounds:this.store.rounds.list(),admission:this.store.admission.gates(),explorations:this.store.admission.list().slice(0,20)};
    const access=this.access(context,false),plans=id?[this.store.get(id,access.view.scope)]:this.store.list(access.view.scope);
    return plans.map(plan=>{const source=plan.body.anchor?this.ctx.dafeiyu.activityAnchorStatus(plan.body.anchor):{state:'stale',code:'ACTIVITY_SOURCE_REQUIRED'};return {id:plan.body.id,version:plan.body.version,status:plan.status,purpose:plan.body.purpose,goal:source.state==='stale'?null:plan.body.goal,trigger:plan.body.trigger,
      quiet:plan.body.quiet,timeZone:plan.body.timeZone,nextDueAt:plan.nextDue===null?null:new Date(plan.nextDue).toISOString(),notBefore:new Date(plan.notBefore).toISOString(),error:plan.error,
      source,dispatch:this.statusView(plan,context.runId).dispatch};});
  }
  private statusView(plan:StoredSchedule,callerRunId?:string){
    const source=plan.body.anchor?this.ctx.dafeiyu.activityAnchorStatus(plan.body.anchor):{state:'stale' as const,code:'ACTIVITY_SOURCE_REQUIRED'};
    const pressure=this.ctx.dafeiyu.activityPressure(),foregroundBusy=pressure.foregroundWaiting+pressure.foregroundRuns>0;
    const waitsForCurrentTask=plan.status==='active'&&source.state==='pending'&&plan.body.anchor?.runId===callerRunId;
    const note=plan.status!=='active'?'计划当前未启用调度。':source.state==='pending'
      ?(waitsForCurrentTask?'配置已保存，正在等待本次设置任务结束或让出；不要在本任务内等待下一轮执行。':'配置已保存，正在等待创建或修改它的任务结束或让出。')
      :source.state==='stale'?'计划的授权来源已失效，需要重新核对。':foregroundBusy?'配置来源有效，后台调度正在等待前台工作结束。':'配置来源有效；是否执行还要核对到期、静默和资源等条件。';
    return {...plan,dispatch:{sourceState:source.state,sourceCode:source.code,waitsForCurrentTask,foregroundBusy,note}};
  }
  private actions():ActionCapability[]{
    const make=(id:string,description:string,inputSchema:z.ZodType,write:boolean,fn:(input:unknown,c:ExecutionContext)=>unknown):ActionCapability=>({id,version:'1',description,inputSchema,outputSchema:z.json(),effects:write?'local-write':'read',scope:id===ACTIVITY_ACTIONS[2]?'any':'task',
      execute:async(input,c)=>{try{return {status:'succeeded',effects:write?'confirmed':'none',completeness:'complete',data:z.json().parse(fn(input,c)),sources:[],receipts:[]};}
        catch(error){const code=error instanceof z.ZodError?'INVALID_INPUT':error instanceof Error&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'ACTIVITY_FAILED';
          return {status:'failed',effects:write&&!['INVALID_INPUT','SOURCE_NOT_EXPOSED','VERSION_CONFLICT','IDEMPOTENCY_CONFLICT','SCOPE_DENIED','ACTIVITY_CANCELLED','ACTIVITY_INTERVAL_TOO_SHORT','ACTIVITY_SOURCE_REQUIRED','ACTIVITY_REPLAN_REQUIRED','ACTIVITY_QUIET_ALL_DAY','PRIVATE_INPUT_REJECTED'].includes(code)?'unknown':'none',completeness:'unknown',data:null,sources:[],receipts:[],errorCode:code};}}});
    return [make(ACTIVITY_ACTIONS[3],'当前活动完成后结束本轮并休息；不重置已经发生的用量。',z.strictObject({}),true,(_i,c)=>{this.access(c,true);return this.scheduler.rest(c.runId);}),make(ACTIVITY_ACTIONS[0],'创建持久计划。主人授权定期看群时 kind=group-watch，watch 指定 joined 或 fixed 与是否回复，trigger 使用 interval；兴趣探索使用 exploration。必须返回实际计划ID。计划不能扩大数据或发言权限。'+ACTIVITY_PLAN_COMPLETION_RULE,planSchema,true,(i,c)=>this.plan(c,i)),
      make(ACTIVITY_ACTIONS[1],'持版本调整自己计划的时间、频率或暂停／取消。改变探索目标创建新的工作代次，原Task目标不改写。'+ACTIVITY_PLAN_COMPLETION_RULE,updateSchema,true,(i,c)=>this.update(c,i)),
      make(ACTIVITY_ACTIONS[2],'查看当前Task拥有或正在执行的活动计划；认证主人也可查询获准管理的计划。dispatch区分等待来源任务与等待前台空闲，不把零次执行当成配置未保存。',z.strictObject({id:z.uuid().optional()}),false,(i,c)=>this.status(c,z.object({id:z.uuid().optional()}).parse(i).id))];
  }
  recover(){if(this.gate.state==='registered')this.gate.recovered();}
  activate(){if(!this.scheduler.hasDependencies())throw new Error('ACTIVITY_MEMORY_REQUIRED');this.gate.activate();}
  bindMaintenance(port:MemoryMaintenanceSchedulingPort){this.scheduler.bindMemory(port);}
  start(automatic=true){this.gate.assertActive();this.scheduler.start(automatic);}
  tick(){return this.scheduler.tick();}
  notify(event:ActivityDomainEvent){return this.scheduler.notify(event);}
  stopBackground(){this.scheduler.stop();}
  whenIdle(){return this.scheduler.whenIdle();}
  quiesce(){this.scheduler.stop();this.gate.quiesce();}
  get lifecycleState(){return this.gate.state;}
  get health(){return {lifecycle:this.gate.state,...this.scheduler.health,counts:this.finalCounts??this.store.counts()};}
  close():Promise<void>{if(this.closing)return this.closing;this.closed=true;this.gate.quiesce();this.scheduler.stop();
    this.closing=(async()=>{await this.scheduler.close();this.handle.dispose();this.finalCounts=this.store.counts();this.store.close();this.gate.close();})();return this.closing;}
}
