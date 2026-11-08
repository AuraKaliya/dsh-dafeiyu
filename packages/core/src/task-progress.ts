import {z} from 'zod';
import {TaskProgressSchema,TaskReviewSchema,TaskDispositionSchema,ActivityPlanReceiptSchema,TaskDeliveryCountsSchema} from '@dafeiyu/contracts';
import type {TaskProgress,TaskState,ActionOutcome} from '@dafeiyu/contracts';
import type {StoredRun} from './runtime-store.js';
import type {NativeDeliveryStore} from './native-delivery-store.js';
import {runtimeHash} from './runtime-store.js';

export interface TaskProgressInput {
  run:StoredRun;task:TaskState;review:unknown;disposition:unknown;
  phase:{phase:unknown}|null;checkpoints:number;
  latestRunId?:string;intentState?:'clear'|'blocked'|'unavailable';
  delivery:ReturnType<NativeDeliveryStore['status']>;
  counts?:unknown;
  operations:readonly {id:string;action:string;state:string;outcome:ActionOutcome|null}[];
}
const executionLabels:Record<TaskProgress['execution']['state'],string>={accepted:'已受理',queued:'等待执行',running:'正在执行',waiting:'等待条件或补充信息',cancelling:'正在取消',continued:'已转入接续运行',completed:'执行已结束',failed:'执行失败，进度已保留',cancelled:'执行已取消',interrupted:'执行中断，进度已保留'};
const deliveryLabels:Record<TaskProgress['delivery']['state'],string>={none:'尚未生成结果交付',accepted:'等待生成结果',rendering:'正在生成结果',verifying:'结果待核验',ready:'结果已核验，等待发送',sending:'正在发送结果',sent:'结果已确认送达', 'not-sent':'结果确定未送达',partial:'结果仅部分确认送达',uncertain:'结果发送回执未知',rejected:'结果交付受阻，尚未送达',interrupted:'结果交付中断'};
const goalLabels={met:'模型判断目标已达成',partial:'模型判断目标部分达成',unmet:'模型判断目标尚未达成',uncertain:'目标达成情况尚不能确认'};

/** Read projection only. Run completion, model judgment and transport receipts never substitute for one another. */
export function buildTaskProgress(input:TaskProgressInput):TaskProgress {
  const {run,task,operations,delivery}=input,currentIntent=task.epoch===run.definition.intentVersion,latestRunId=input.latestRunId??run.id,currentRun=latestRunId===run.id;
  const disposition=TaskDispositionSchema.safeParse(input.disposition),review=z.object({review:TaskReviewSchema}).safeParse(input.review);
  const assessment=currentIntent&&currentRun&&disposition.success&&disposition.data.goalStatus?{status:disposition.data.goalStatus,source:'agent' as const}:null;
  const goal={status:assessment?.status??'uncertain' as const,source:assessment?.source??'none' as const,reviewStatus:currentIntent&&currentRun&&review.success?review.data.review.goalStatus:null,programVerified:false as const};
  const plans=operations.flatMap(operation=>{
    if(!['dafeiyu_activity_plan','dafeiyu_activity_update'].includes(operation.action)||operation.outcome?.status!=='succeeded'||operation.outcome.effects!=='confirmed')return [];
    const receipt=ActivityPlanReceiptSchema.safeParse(operation.outcome.data);return receipt.success?[{id:receipt.data.id,version:receipt.data.version,
      intervalMs:receipt.data.trigger.kind==='interval'?receipt.data.trigger.intervalMs:null,configurationOnly:true as const}]:[];
  });
  const inspection={catalogCalls:0,dispatchCalls:0,resultReads:0,partialReads:0,failedCalls:0,failedCommands:0};
  for(const operation of operations){
    if(operation.action==='dsh_tool_list'){inspection.catalogCalls++;continue;}
    if(!['dsh_tool_call','dsh_tool_read','dsh_result_read','dsh_result_read_batch'].includes(operation.action))continue;
    if(['dsh_tool_call','dsh_tool_read'].includes(operation.action)&&operation.outcome?.receipts.some(receipt=>receipt.kind==='dsh-operation'&&receipt.id===operation.id))inspection.dispatchCalls++;
    if(operation.outcome?.status==='failed'||operation.outcome?.status==='unknown'){inspection.failedCalls++;continue;}
    const outer=z.object({page:z.unknown()}).safeParse(operation.outcome?.data);
    const batch=z.object({kind:z.literal('archived-result-batch'),items:z.array(z.object({status:z.string(),page:z.unknown().optional()}))}).safeParse(outer.success?outer.data.page:null);
    if(batch.success)inspection.failedCalls+=batch.data.items.filter(item=>item.status==='failed').length;
    const pages=batch.success?batch.data.items.filter(item=>item.status==='ok').map(item=>item.page):outer.success?[outer.data.page]:[];
    for(const raw of pages){const page=z.object({view:z.object({coverage:z.object({complete:z.boolean()}),entries:z.array(z.object({key:z.string(),value:z.unknown().optional()})).optional()})}).safeParse(raw);
      if(page.success){inspection.resultReads++;if(!page.data.view.coverage.complete)inspection.partialReads++;
        const exit=page.data.view.entries?.find(row=>row.key==='exitCode')?.value;if(exit!==undefined&&exit!==null&&Number(exit)!==0)inspection.failedCommands++;}}
  }
  const measured=TaskDeliveryCountsSchema.safeParse(input.counts),counts=measured.success?measured.data:null;
  const deliveryState=counts&&(counts.unknown||counts.sending)&&delivery?.state==='sent'?'uncertain' as const:delivery?.state??'none';
  const execution={state:run.state,phase:run.state==='running'&&typeof input.phase?.phase==='string'?input.phase.phase:null,version:run.version};
  const delivered={state:deliveryState,version:delivery?.version??0,counts};
  const facts={plans,inspection,confirmedOperations:operations.filter(row=>row.outcome?.effects==='confirmed').length,
    unknownEffects:operations.filter(row=>row.state==='unknown'||row.outcome?.effects==='unknown').length};
  let next:TaskProgress['next']={action:'none',label:''},blocked={code:null as string|null,reason:''};
  if(!currentIntent||task.status==='paused'){blocked={code:!currentIntent?'TASK_INTENT_CHANGED':'TASK_PAUSED',reason:!currentIntent?'目标已变更，旧结果不能代表当前目标。':'任务已暂停或取消。'};}
  else if(!currentRun){blocked={code:'RUN_SUPERSEDED',reason:'此运行已有后续进展，请查看最新运行。'};}
  else if(input.intentState&&input.intentState!=='clear'){blocked={code:input.intentState==='blocked'?'TASK_OBJECTION_UNRESOLVED':'TASK_INTENT_UNAVAILABLE',reason:'任务条件或异议仍需核对。'};next={action:'review-source',label:'先处理阻塞条件，不能仅通过重复恢复跳过。'};}
  else if(delivery?.recovery.pendingRequestId)next={action:'wait',label:'交付恢复已受理，等待实际核验和发送结果。'};
  else if(deliveryState==='uncertain'||counts?.unknown){blocked={code:'DELIVERY_EFFECT_UNCERTAIN',reason:'存在尚未核实的发送回执。'};next={action:'verify-delivery',label:'先核对发送回执，不自动重发。'};}
  else if(facts.unknownEffects){blocked={code:'OPERATION_UNCERTAIN',reason:'存在尚未核实的操作效果。'};next={action:'review-source',label:'先核对已有操作的实际效果，不重做未知操作。'};}
  else if(delivery?.recovery.reason==='DELIVERY_SOURCE_UNAVAILABLE'||delivery?.recovery.reason==='DELIVERY_RECOVERY_EXPIRED'){
    blocked={code:delivery.recovery.reason,reason:'资料、授权或有效期需要重新核对。'};next={action:'review-source',label:'先核对来源；不会自动恢复失效授权。'};
  }
  else if(delivery?.recovery.available)next={action:'resume-delivery',label:'可在重新核对来源后继续结果交付。'};
  else if(['failed','waiting','interrupted'].includes(run.state)){blocked={code:run.error,reason:run.state==='waiting'?'当前任务仍在等待条件或补充信息。':'任务执行中断，已完成的工作仍保留。'};
    next=input.checkpoints?{action:'resume-task',label:'核对阻塞原因后，从原任务进度继续。'}:{action:'review-source',label:'查看阻塞原因和可用进度。'};}
  else if(['not-sent','partial','rejected','interrupted'].includes(deliveryState)){blocked={code:delivery?.error??null,reason:'业务结果仍保留，交付尚未完成。'};next={action:'review-source',label:'核对来源、有效期和交付记录后再处理。'};}
  else if(deliveryState==='sent'&&goal.status!=='met')next={action:'review-result',label:'结果已送达；目标是否满足需结合结果判断。'};
  if(!blocked.reason&&delivery?.error)blocked={code:delivery.error,reason:'结果交付遇到阻塞，已完成的业务记录仍保留。'};
  const labels={goal:!currentIntent?'目标已变更，旧判断不适用':!currentRun?'此运行已有后续进展，旧判断仅供回看':goalLabels[goal.status],execution:executionLabels[execution.state],delivery:deliveryLabels[deliveryState]};
  const projection={schemaVersion:1 as const,taskId:task.id,runId:run.id,currentIntent,currentRun,latestRunId,taskState:task.status,goal,execution,delivery:delivered,facts,blocked,next,labels};
  // Labels and wall-clock display are not the identity of a status notification.
  return TaskProgressSchema.parse({...projection,version:runtimeHash({runVersion:run.version,taskVersion:task.version,intent:task.epoch,
    goal,facts,latestRunId,executionPhase:execution.phase,deliveryVersion:delivery?.version??0,deliveryState,counts,blockedCode:blocked.code,nextAction:next.action,recoveryReason:delivery?.recovery.reason??null,pendingRecovery:delivery?.recovery.pendingRequestId??null})});
}

/** Fixed, bounded program facts only; no task body, draft, error payload or model call. */
export function taskFailureNotice(progress:TaskProgress):string|null {
  if(!progress.currentIntent||!progress.currentRun||progress.taskState!=='active')return null;
  const executionFailed=['failed','interrupted'].includes(progress.execution.state),deliveryFailed=['rejected','interrupted','not-sent','partial','uncertain'].includes(progress.delivery.state);
  if(!executionFailed&&!deliveryFailed)return null;
  const reason=progress.blocked.code??'';
  const dependency=reason.startsWith('MODEL_')?'本次模型调用未成功。':reason.startsWith('DELIVERY_VERIFICATION_')?'结果核验未完成。':reason==='DELIVERY_RENDER_TIMEOUT'?'结果生成超时。':/SOURCE|AUTHORITY|SCOPE|EXPIRED/.test(reason)?'资料或授权需要重新核对。':'';
  const stage=executionFailed?'这次任务执行中断，已有进度和记录已保存。':progress.delivery.state==='uncertain'?'任务结果的发送回执未知，不能自动重发。':progress.delivery.state==='partial'?'任务结果只确认了部分发送，已确认的部分不会重发。':progress.execution.state==='completed'?'业务执行已结束，但结果交付尚未完成，已有工作记录保留。':'任务仍在等待条件，本次结果交付受阻，已有记录保留。';
  const delivery=progress.delivery.state==='none'?'尚未形成最终结果交付。':progress.delivery.state==='rejected'||progress.delivery.state==='interrupted'?'结果尚未确认送达。':progress.labels.delivery+'。';
  return [stage,dependency,delivery,progress.next.label].filter(Boolean).join('');
}
