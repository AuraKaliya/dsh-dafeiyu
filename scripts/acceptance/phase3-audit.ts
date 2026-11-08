import {z} from 'zod';
import {hash} from './io.mjs';
import {databaseEvidenceSchema,requestMeasurementSchema} from './schema.ts';
const scene=z.object({channel:z.string(),account:z.string(),kind:z.string(),id:z.string()});
const counts=z.object({total:z.number().int().positive(),confirmed:z.number(),pending:z.number(),unknown:z.number(),state:z.string()});
/** Check persisted identities, actual part receipts and request phases; never trust a fixture's pass flag. */
export function auditPhaseThree(id:string,raw:unknown){
  const base=z.object({database:databaseEvidenceSchema,requests:z.array(requestMeasurementSchema)}).parse(raw),db=base.database,checks:{id:string;passed:boolean}[]=[],check=(id:string,passed:boolean)=>checks.push({id,passed});
  const rawDatabase=z.object({database:z.unknown()}).parse(raw).database;
  const sessions=(values:(string|null)[])=>values.sort();check('requests-reconciled',hash(sessions(db.requests.map(row=>row.body.sessionId)))===hash(sessions(base.requests.map(row=>row.sessionId)))&&db.requests.every(row=>row.settlement!==null)&&new Set(db.requests.map(row=>row.id)).size===db.requests.length);
  if(id==='combined-probe-business'){
    const data=z.object({videoReads:z.number(),delivered:z.array(z.object({text:z.string()})),gates:z.object({first:z.object({generation:z.number()}),failedContinuation:z.object({generation:z.number(),reason:z.string()}),current:z.object({generation:z.number(),reason:z.string()})}),probes:z.array(z.object({state:z.string()}))}).parse(raw);
    const runs=db.runs.filter(run=>run.definition.taskId),tasks=new Set(runs.map(run=>run.definition.taskId));
    check('one-task-three-runs',runs.length===3&&tasks.size===1&&runs.filter(run=>run.state==='failed').length===2&&runs.filter(run=>run.state==='completed').length===1);
    check('probe-not-business-proof',data.gates.failedContinuation.reason==='MODEL_HTTP_402'&&data.gates.failedContinuation.generation>data.gates.first.generation&&data.gates.current.reason==='restored'&&data.gates.current.generation>data.gates.failedContinuation.generation&&data.probes.length===2&&data.probes.every(probe=>probe.state==='succeeded'));
    check('reuse-reading-and-deliver',data.videoReads===1&&db.operations.filter(op=>op.action==='bili_video').length===1&&data.delivered.length===1&&db.deliveries.length===1&&db.deliveries[0]?.state==='sent'&&!!db.deliveries[0]?.receipt);
  }else if(id==='combined-media-revoke'){
    const data=z.object({before:z.object({runId:z.string(),deliveryId:z.string(),taskId:z.string()}),after:z.object({runId:z.string(),deliveryId:z.string(),taskId:z.string(),state:z.string()}),sends:z.array(z.string()),attempts:z.array(z.string()),acquisitions:z.number(),modelCallsBeforeRecovery:z.number(),transport:counts}).parse(raw);
    check('same-media-work',data.before.runId===data.after.runId&&data.before.deliveryId===data.after.deliveryId&&data.before.taskId===data.after.taskId&&data.acquisitions===1&&db.runs.filter(run=>run.definition.taskId===data.before.taskId).length===1);
    check('revoked-export-not-sent',data.sends.length===1&&data.attempts.length===1&&data.transport.confirmed===1&&data.transport.pending===1&&data.transport.unknown===0&&data.after.state!=='sent'&&base.requests.length===data.modelCallsBeforeRecovery);
  }else{
    const data=z.object({mode:z.string(),originalRun:z.string(),taskId:z.string(),stages:z.array(z.object({label:z.string(),requestCount:z.number(),delivery:z.object({runId:z.string(),deliveryId:z.string(),taskId:z.string(),state:z.string(),recovery:z.object({phase:z.string().nullable()})}).nullable()})),
      sends:z.array(z.object({runId:z.string(),text:z.string(),receipt:z.string(),target:scene,sourceMessageId:z.string()})),attempts:z.array(z.object({runId:z.string(),text:z.string(),target:scene})),verificationInputs:z.array(z.string()),notices:z.array(z.string()),
      finalProgress:z.object({currentIntent:z.boolean(),currentRun:z.boolean(),taskState:z.string()}),transport:counts.extend({segments:z.array(z.object({state:z.string(),receipt:z.string().nullable()}))}).nullable()}).parse(raw);
    const original=data.sends.filter(row=>row.runId===data.originalRun),delivery=db.deliveries.find(row=>row.run_id===data.originalRun),taskRuns=db.runs.filter(run=>run.definition.taskId===data.taskId);
    check('source-and-delivery-binding',data.mode===id.slice('combined-'.length)&&taskRuns.length===(data.mode==='revise'?2:1)&&data.stages.every(stage=>!stage.delivery||stage.delivery.runId===data.originalRun&&stage.delivery.taskId===data.taskId)&&new Set(data.stages.flatMap(stage=>stage.delivery?[stage.delivery.deliveryId]:[])).size<=1);
    const rows=z.object({deliveries:z.array(z.object({run_id:z.string(),anchor:z.object({target:scene,taskId:z.string(),runId:z.string()})}))}).parse(rawDatabase);
    check('actual-target-and-source',data.sends.every(send=>{const row=rows.deliveries.find(row=>row.run_id===send.runId);return !!row&&row.anchor.runId===send.runId&&row.anchor.taskId===data.taskId&&hash(row.anchor.target)===hash(send.target)&&send.sourceMessageId===(send.runId===data.originalRun?'owner-original':'owner-interruption');}));
    check('one-business-read',db.operations.filter(op=>op.action==='qq_browse').length===1);
    check('unapproved-text-never-sent',data.sends.every(row=>!row.text.includes('所有群的消息都已经正常投递'))&&data.notices.every(text=>!text.includes('COMBINED_GROUP_EVIDENCE')));
    if(data.mode!=='revoke-query'&&data.mode!=='revoke-render')check('same-candidate-on-verifier-recovery',data.verificationInputs.length===3&&data.verificationInputs[0]===data.verificationInputs[1]&&data.verificationInputs[1]!==data.verificationInputs[2]);
    const expected=data.mode==='chain'?2:['cancel','revise','unknown','revoke-between'].includes(data.mode)?1:0;
    check('confirmed-parts-once',original.length===expected&&new Set(original.map(row=>row.text)).size===expected&&(data.transport?data.transport.confirmed===expected&&data.transport.segments.filter(row=>row.state==='sent').every(row=>!!row.receipt):expected===0));
    if(data.transport){const parts=data.transport.segments;check('receipt-counts-match-actual-sends',parts.length===data.transport.total&&parts.filter(part=>part.state==='sent').length===data.transport.confirmed&&parts.filter(part=>part.state==='pending').length===data.transport.pending&&parts.filter(part=>part.state==='unknown').length===data.transport.unknown&&!parts.some(part=>part.state==='sending')&&hash(parts.flatMap(part=>part.state==='sent'?[part.receipt]:[]).sort())===hash(original.map(row=>row.receipt).sort()));}
    check('no-extra-model-after-final-stage',data.stages.at(-1)?.requestCount===base.requests.length);
    if(data.mode==='chain'){
      const sent=data.stages.find(row=>row.label==='delivered'),partial=data.stages.find(row=>row.label==='after-repair-and-dispatch');
      check('full-recovery-chain',data.stages.find(row=>row.label==='render-failed')?.delivery?.recovery.phase==='rendering'&&data.stages.find(row=>row.label==='verification-failed')?.delivery?.recovery.phase==='verification'&&partial?.delivery?.state==='partial'&&sent?.delivery?.state==='sent'&&sent.requestCount===partial.requestCount&&delivery?.state==='sent');
      const events=z.object({recoveryEvents:z.array(z.object({runId:z.string(),type:z.string(),data:z.object({phase:z.string().optional()})}))}).parse(rawDatabase).recoveryEvents;
      check('recovery-ledger-phases',['rendering','verification','sending'].every(phase=>events.some(event=>event.runId===data.originalRun&&event.type==='native.delivery.recovery.requested'&&event.data.phase===phase)));
    }else if(data.mode==='unknown')check('unknown-never-retried',data.transport?.unknown===1&&data.attempts.filter(row=>row.runId===data.originalRun).length===2&&delivery?.state==='uncertain');
    else if(data.mode==='cancel'||data.mode==='revise'){
      const controls=z.object({operations:z.array(z.object({action:z.string(),outcome:z.object({status:z.string(),effects:z.string(),data:z.unknown()}).nullable()}))}).parse(rawDatabase).operations.filter(op=>op.action==='fixture_task_control');
      check('real-control-invalidates-old-result',controls.some(op=>op.outcome?.status==='succeeded'&&op.outcome.effects==='confirmed')&&(!data.finalProgress.currentIntent||data.finalProgress.taskState==='paused'));
      if(data.mode==='revise')check('new-intent-separate',!data.finalProgress.currentRun&&data.sends.filter(row=>row.runId!==data.originalRun&&row.text.includes('REVISED_RESULT')).length===1);
    }else check('withdrawn-result-stays-blocked',delivery?.state!=='sent');
  }
  return {checks,baseline:{kind:'offline-combination',requests:base.requests.length,inputBytes:base.requests.reduce((sum,row)=>sum+row.inputBytes,0),paidCalls:false,semanticReliabilityProven:false}};
}
