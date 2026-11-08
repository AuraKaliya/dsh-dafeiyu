import {z} from 'zod';
import {hash} from './io.mjs';
import {databaseEvidenceSchema,requestMeasurementSchema} from './schema.ts';
const scene=z.object({channel:z.string(),account:z.string(),kind:z.string(),id:z.string()});
const sameScene=(left:unknown,right:unknown)=>hash(scene.parse(left))===hash(scene.parse(right));

export function auditPhaseOne(id:string,raw:unknown){
  const data=z.record(z.string(),z.unknown()).parse(raw),db=databaseEvidenceSchema.parse(data.database),requests=z.array(requestMeasurementSchema).parse(data.requests);
  const checks:{id:string;passed:boolean}[]=[],check=(id:string,passed:boolean)=>checks.push({id,passed});
  const sessions=(values:readonly (string|null)[])=>[...values.reduce((all,key)=>all.set(key,(all.get(key)??0)+1),new Map<string|null,number>())].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
  check('requests-accounted',hash(sessions(requests.map(row=>row.sessionId)))===hash(sessions(db.requests.map(row=>row.body.sessionId)))&&new Set(db.requests.map(row=>row.id)).size===db.requests.length&&db.requests.every(row=>row.settlement!==null));
  const progress=z.object({taskId:z.string(),runId:z.string(),version:z.string(),goal:z.object({status:z.string(),source:z.string(),programVerified:z.literal(false)}),execution:z.object({state:z.string()}),delivery:z.object({state:z.string()})}).parse(data.progress);
  check('execution-projection',db.runs.some(run=>run.id===progress.runId&&run.definition.taskId===progress.taskId&&run.state===progress.execution.state));
  if(id.includes('fault-notice')){
    const feedback=z.array(z.object({id:z.string(),runId:z.string(),taskId:z.string(),sourceMessageId:z.string(),statusVersion:z.string(),state:z.string(),attempts:z.number(),deliveryId:z.string(),receiptId:z.string().optional()})).parse(data.feedback);
    const notices=z.array(z.object({id:z.string(),text:z.string(),conversation:z.object({channel:z.string(),account:z.string(),kind:z.string(),id:z.string()})})).parse(data.notices);
    const sources=z.object({sources:z.array(z.object({runId:z.string(),inboundId:z.string(),target:z.unknown()}))}).parse(data.database).sources;
    check('one-notice-attempt',feedback.length===1&&notices.length===1&&feedback[0]?.attempts===1);
    check('original-source-and-target',feedback.every(record=>record.runId===progress.runId&&record.taskId===progress.taskId&&record.statusVersion===progress.version&&sources.some(source=>source.runId===record.runId&&source.inboundId===record.sourceMessageId&&sameScene(source.target,notices[0]?.conversation))));
    check('no-notice-model-call',data.failedModelCalls===1&&!db.requests.some(row=>['feedback','recovery'].includes(row.body.phase)));
    check('notice-receipt',id==='fault-notice-unknown'?feedback[0]?.state==='unknown'&&!feedback[0]?.receiptId:feedback[0]?.state==='sent'&&!!feedback[0]?.receiptId);
    check('notice-is-not-result-delivery',id==='execution-fault-notice'?progress.execution.state==='failed'&&progress.delivery.state==='none':progress.execution.state==='completed'&&progress.delivery.state==='rejected');
    check('no-fabricated-goal',progress.goal.status==='uncertain'&&progress.goal.source==='none');
    check('bounded-status-only-text',notices.every(row=>row.text.length<1000&&!/GROUP_TEXT_MUST_REACH_OWNER|MODEL_HTTP|402|任务已完成|结果已发送/.test(row.text)));
  }else if(id.startsWith('task-send-')){
    const state=z.object({deliveryId:z.string(),taskId:z.string(),runId:z.string(),state:z.string()}),before=state.parse(data.before),after=state.parse(data.after);
    const transport=z.object({state:z.string(),total:z.number(),confirmed:z.number(),pending:z.number(),unknown:z.number(),segments:z.array(z.object({state:z.string(),receipt:z.string().nullable()})).optional(),parts:z.array(z.object({state:z.string(),receipt:z.string().nullable()})).optional()}).parse(data.transport);
    const parts=transport.parts??transport.segments??[];
    check('part-counts-consistent',parts.length===transport.total&&parts.filter(part=>part.state==='sent').length===transport.confirmed&&parts.filter(part=>part.state==='pending').length===transport.pending&&parts.filter(part=>part.state==='unknown').length===transport.unknown&&!parts.some(part=>part.state==='sending'));
    check('same-task-and-delivery',before.deliveryId===after.deliveryId&&before.runId===after.runId&&before.taskId===after.taskId&&after.runId===progress.runId);
    check('result-bound-to-run',db.deliveries.length===1&&db.deliveries[0]?.run_id===after.runId&&db.deliveries[0]?.anchor.taskId===after.taskId);
    check('no-business-run-replay',db.runs.filter(run=>run.definition.taskId===before.taskId).length===1);
    const sends=z.array(z.string()).parse(data.sends),attempts=z.array(z.string()).parse(data.attempts);
    check('no-goal-from-send',progress.goal.status==='uncertain'&&progress.goal.source==='none');
    if(id==='task-send-unknown'){
      check('unknown-not-retried',after.state==='uncertain'&&transport.unknown===1&&transport.confirmed===1&&attempts.length===2&&sends.length===1);
    }else{
      check('confirmed-only-once',after.state==='sent'&&transport.state==='sent'&&transport.total===2&&transport.confirmed===2&&transport.pending===0&&transport.unknown===0&&sends.length===2&&new Set(sends).size===2&&(transport.parts??transport.segments??[]).every(part=>part.state==='sent'&&!!part.receipt));
      check('same-approved-body-without-model',data.modelCallsBeforeRecovery===requests.length&&db.deliveries.length===1&&!!db.deliveries[0]?.receipt);
      if(id==='task-send-media')check('frozen-media-reused',data.acquisitions===1&&z.array(z.string()).parse(data.mediaManifests).length===2&&new Set(z.array(z.string()).parse(data.mediaManifests)).size===1);
    }
  }else if(id==='diagnostic-flow'){
    const source=z.object({version:z.string(),text:z.string(),sha256:z.string()}).parse(data.source),sent=z.array(z.string()).parse(data.sent);
    const reads=db.operations.filter(operation=>operation.action==='dsh_tool_read'&&operation.outcome?.status==='succeeded');
    check('actual-file-and-report',hash(source.text)===source.sha256&&data.reads===1&&reads.length===1&&sent.some(text=>text.includes(source.sha256)));
    const actual=z.object({operations:z.array(z.object({id:z.string(),action:z.string(),outcome:z.unknown()}))}).parse(data.database).operations.find(row=>row.action==='dsh_tool_read');
    const read=z.object({data:z.object({page:z.object({view:z.object({entries:z.array(z.object({key:z.string(),value:z.unknown().optional()})),coverage:z.object({complete:z.boolean()})})})}),receipts:z.array(z.object({kind:z.string(),id:z.string()}))}).parse(actual?.outcome);
    const entries=read.data.page.view.entries,lines=z.array(z.string()).parse(entries.find(row=>row.key==='sourceLines')?.value);
    check('returned-source-evidence',read.data.page.view.coverage.complete&&entries.find(row=>row.key==='sha256')?.value===source.sha256&&entries.find(row=>row.key==='version')?.value===source.version&&lines.some(line=>line.trim())&&source.text.replaceAll('\r\n','\n').includes(lines.join('\n'))&&read.receipts.some(row=>row.kind==='dsh-operation'&&row.id===actual?.id));
    check('report-delivered',progress.delivery.state==='sent'&&db.deliveries.length===1&&db.deliveries[0]?.state==='sent'&&!!db.deliveries[0]?.receipt);
    check('assessment-labelled-as-model',progress.goal.status==='met'&&progress.goal.source==='agent');
  }else throw new Error('ACCEPTANCE_SCENARIO_UNKNOWN');
  return {checks,baseline:{kind:'offline-sdk-byte-baseline',requests:requests.length,inputBytes:requests.reduce((n,row)=>n+row.inputBytes,0),unknownUsageRequests:db.requests.filter(row=>row.settlement?.receipt.tokens===null).length,paidCalls:false,monetaryCost:null}};
}
