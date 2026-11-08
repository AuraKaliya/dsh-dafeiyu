import {join, resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {catalog, criteriaVersion, allRequirements, offlineConfiguration} from './catalog.ts';
import {artifactSchema, manifestSchema, completionSchema, databaseEvidenceSchema, planSchema, requestMeasurementSchema} from './schema.ts';
import {readJson, hash, saveJson, fingerprint} from './io.mjs';
import {auditPhaseOne} from './phase1-audit.ts';
import {auditContextFolding} from './context-audit.ts';

const record = z.record(z.string(), z.unknown());
const deliveredSchema = z.array(z.object({text:z.string(),conversation:z.object({kind:z.string(),id:z.string()})}));
export interface Check {id: string; passed: boolean}
export interface ScenarioAudit {id: string; state: 'passed'|'failed'|'not-executed'; checks: Check[]; limitation: string; baseline: unknown}

/** Uses program records and observed outputs; it never accepts a scenario's claimed verdict. */
export function auditScenario(id: string, raw: unknown): {checks: Check[]; baseline: unknown} {
  if(id==='context-folding')return auditContextFolding(raw);
  if(id.includes('fault-notice')||id.startsWith('task-send-')||id==='diagnostic-flow')return auditPhaseOne(id,raw);
  const checks: Check[] = [];
  const check = (name: string, passed: boolean) => checks.push({id: name, passed});
  const evidence = record.parse(raw);
  let baseline: unknown = null;
  if (id.startsWith('patrol-') || id === 'owner-report' || id === 'video-reading' || id.startsWith('delivery-')) {
    const database = databaseEvidenceSchema.parse(evidence.database);
    const requests = z.array(requestMeasurementSchema).parse(evidence.requests);
    const sessions = (values: readonly (string|null)[]) => [...values.reduce((counts, value) => counts.set(value, (counts.get(value) ?? 0) + 1), new Map<string|null,number>())].sort((a,b)=>String(a[0]).localeCompare(String(b[0])));
    check('request-identities-unique', new Set(database.requests.map(row=>row.id)).size === database.requests.length);
    check('requests-reconciled', hash(sessions(requests.map(row=>row.sessionId))) === hash(sessions(database.requests.map(row=>row.body.sessionId))));
    check('requests-settled', database.requests.every(row=>row.settlement !== null));
    const delivered = id==='video-reading'?[]:deliveredSchema.parse(evidence.delivered);
    if(id!=='video-reading')check('delivery-receipts', database.deliveries.length > 0 && database.deliveries.every(row=>row.state==='sent' && !!row.receipt));
    check('delivery-bodies-observed', database.deliveries.every(row=>delivered.some(sent=>sent.text===row.body && sent.conversation.kind===row.anchor.target.kind && sent.conversation.id===row.anchor.target.id)));
    check('delivery-run-bindings', database.deliveries.every(row=>database.runs.some(run=>run.id===row.run_id && run.state==='completed' && run.definition.taskId===row.anchor.taskId)));
    baseline = {kind:'offline-sdk-byte-baseline', model:offlineConfiguration.model, requests:requests.length,
      inputBytes:requests.reduce((n,r)=>n+r.inputBytes,0), toolResultBytes:requests.reduce((n,r)=>n+r.toolResultBytes,0),
      repeatedToolResultBytes:requests.reduce((n,r)=>n+r.repeatedToolResultBytes,0), maximumInputBytes:Math.max(0,...requests.map(row=>row.inputBytes)),
      unknownUsageRequests:database.requests.filter(row=>row.settlement?.receipt.tokens===null).length,
      paidCalls:false, monetaryCost:null, note:'脚本模型输入字节与请求计数，不是模型token或真实费用基线'};
    if (id.startsWith('patrol-')) {
      const before=planSchema.parse(evidence.before), after=planSchema.parse(evidence.after), restart=planSchema.parse(evidence.afterRestart);
      check('same-plan-id', before.body.id===after.body.id && after.body.id===restart.body.id);
      check('one-plan', evidence.planCount===1);
      check('updated-interval', before.body.trigger.intervalMs===60000 && after.body.trigger.intervalMs===120000 && restart.body.trigger.intervalMs===120000);
      check('next-version', after.body.version===before.body.version+1 && restart.body.version===after.body.version);
      check('watch-and-quiet-preserved', hash(before.body.watch)===hash(after.body.watch) && hash(before.body.quiet)===hash(after.body.quiet));
      check('watermark-retained', evidence.cursor===1);
      check('plan-active-after-restart', after.status==='active' && restart.status==='active');
      const waits=z.array(z.object({sourceState:z.string(),foregroundBusy:z.boolean(),patrolBefore:z.number(),patrolAfter:z.number()})).parse(evidence.configurationWaits);
      check('no-configuration-self-wait', waits.length===2 && waits.every(row=>row.sourceState==='pending' && row.patrolBefore===row.patrolAfter));
      check('patrol-isolated-and-not-replayed', evidence.patrolCalls===1 && delivered.filter(row=>row.conversation.kind==='group'&&row.conversation.id==='300001').length===1 && !delivered.some(row=>row.conversation.id==='300002'));
      check('no-private-context-leak', delivered.filter(row=>row.conversation.kind==='group').every(row=>!row.text.includes('PRIVATE_SECRET')&&!row.text.includes('GROUP_B_SECRET')));
      if (id==='patrol-amend') check('same-task', before.body.owner.kind==='task' && before.body.owner.taskId===after.body.owner.taskId);
    } else if(id==='owner-report') {
      check('exact-owner-target', delivered.length===1 && delivered[0]?.conversation.kind==='private' && delivered[0]?.conversation.id==='200001');
      check('final-observation', delivered[0]?.text.includes('GROUP_TEXT_MUST_REACH_OWNER')===true && delivered[0]?.text.includes('确实提到了我')===true);
      check('business-read-not-replayed', database.operations.filter(row=>row.action==='qq_browse'&&row.outcome?.status==='succeeded').length===1);
      check('bounded-repair-reused-material', database.requests.filter(row=>row.body.phase==='rendering').length===3 && database.requests.filter(row=>row.body.phase==='verification').length===4);
    } else if(id.startsWith('delivery-')) {
      const status=z.object({deliveryId:z.string(),taskId:z.string(),runId:z.string(),state:z.string()});
      const before=status.parse(evidence.before),after=status.parse(evidence.after);
      check('same-task-run-and-delivery',before.taskId===after.taskId&&before.runId===after.runId&&before.deliveryId===after.deliveryId&&before.state==='rejected'&&after.state==='sent');
      check('business-not-replayed',database.runs.filter(run=>run.definition.taskId===before.taskId).length===1&&database.operations.filter(op=>op.action==='qq_browse'&&op.outcome?.status==='succeeded').length===1);
      check('one-final-delivery',delivered.length===1&&database.deliveries.length===1);
      const events=z.object({recoveryEvents:z.array(z.object({runId:z.string(),type:z.string(),data:z.record(z.string(),z.unknown())}))}).parse(evidence.database).recoveryEvents;
      check('recovery-recorded-and-settled',events.filter(event=>event.runId===before.runId&&event.type==='native.delivery.recovery.requested').length===1&&events.some(event=>event.runId===before.runId&&event.type==='native.delivery.recovery.settled'&&event.data.state==='sent'&&event.data.error===null));
      check('rendering-stage-only',database.requests.filter(row=>row.body.phase==='rendering').length===(id==='delivery-render-recovery'?2:1));
      if(id==='delivery-verifier-recovery'){
        const inputs=z.array(z.string()).parse(evidence.verificationInputs);
        check('same-verification-candidate-and-evidence',inputs.length===2&&inputs[0]===inputs[1]);
      }
    } else {
      const videos=z.array(z.string()).parse(evidence.videos),progress=z.object({kind:z.literal('bilibili-reading-progress'),total:z.number()}).parse(evidence.progress);
      check('eight-records-one-task', videos.length===8&&new Set(videos).size===8&&progress.total===8&&database.runs.length===1&&database.runs[0]?.state==='completed');
      check('metadata-only-coverage', database.operations.filter(row=>row.action==='bili_video'&&row.outcome?.status==='succeeded').length===8&&database.operations.filter(row=>row.action==='bili_reading_save'&&row.outcome?.status==='succeeded').length===8);
      check('reads-not-repeated', evidence.platformCalls===8&&requests.length===17&&new Set(requests.map(row=>row.sessionId)).size===1);
    }
  } else if (id==='dsh-result-read') {
    const data=z.object({resultId:z.string(),page:z.object({resultId:z.string(),execution:z.object({isError:z.boolean(),effect:z.string()}),view:z.object({entries:z.array(z.object({key:z.string(),value:z.unknown().optional()})),coverage:z.object({complete:z.boolean()})})})}).parse(raw);
    const lines=z.array(z.object({number:z.number(),text:z.string()})).parse(data.page.view.entries.find(row=>row.key==='lines')?.value);
    check('same-operation-result', data.resultId===data.page.resultId);
    check('read-succeeded', !data.page.execution.isError && data.page.execution.effect==='none');
    check('actual-source-not-directory', data.page.view.coverage.complete && lines.length===70 && lines.every((line,index)=>line.number===400+index && line.text===`if (message.group_id === group_${index}) return allowed;`));
  } else throw new Error('ACCEPTANCE_SCENARIO_UNKNOWN');
  return {checks,baseline};
}

export function auditAcceptance(manifestRaw: unknown, completionRaw: unknown, artifacts: ReadonlyMap<string,unknown>) {
  const manifest=manifestSchema.parse(manifestRaw), completion=completionSchema.parse(completionRaw);
  const checks:Check[]=[];
  const check=(id:string,passed:boolean)=>checks.push({id,passed});
  check('same-run', manifest.runId===completion.runId);
  check('criteria-version', manifest.criteriaVersion===criteriaVersion);
  check('fixed-catalog', manifest.catalogHash===hash(catalog) && hash(manifest.scenarios)===hash(catalog.map(row=>row.id)));
  check('fixed-configuration', manifest.configHash===hash(offlineConfiguration));
  check('source-unchanged', manifest.sourceHash===completion.sourceHash);
  check('driver-unchanged', manifest.driverHash===completion.driverHash);
  check('test-process-succeeded', completion.testExitCode===0);
  check('valid-time-range', Date.parse(completion.finishedAt)>=Date.parse(manifest.startedAt));
  check('no-extra-artifacts', artifacts.size===catalog.length && [...artifacts.keys()].every(id=>catalog.some(row=>row.id===id)));
  check('sealed-artifact-set', hash(Object.keys(completion.artifactHashes).sort())===hash([...artifacts.keys()].sort()));
  const scenarios:ScenarioAudit[]=catalog.map(spec=>{
    if (!artifacts.has(spec.id)) return {id:spec.id,state:'not-executed',checks:[],baseline:null,limitation:spec.limitation};
    const parsed=artifactSchema.safeParse(artifacts.get(spec.id));
    if (!parsed.success) return {id:spec.id,state:'failed',checks:[{id:'artifact-schema',passed:false}],baseline:null,limitation:spec.limitation};
    const artifact=parsed.data;
    const binding:Check[]=[{id:'artifact-binding',passed:artifact.runId===manifest.runId && artifact.scenarioId===spec.id && artifact.version===manifest.version && artifact.apiVersion===manifest.apiVersion && artifact.sourceHash===manifest.sourceHash && artifact.driverHash===manifest.driverHash && artifact.runtimeHash===completion.runtimeHash},
      {id:'artifact-time',passed:Date.parse(artifact.capturedAt)>=Date.parse(manifest.startedAt)&&Date.parse(artifact.capturedAt)<=Date.parse(completion.finishedAt)},
      {id:'artifact-hash',passed:completion.artifactHashes[spec.id]===hash(artifact)}];
    if(spec.id==='diagnostic-flow')binding.push({id:'material-version',passed:z.object({source:z.object({version:z.literal(manifest.version)})}).safeParse(artifact.evidence).success});
    try {
      const result=auditScenario(spec.id,artifact.evidence),all=[...binding,...result.checks];
      return {id:spec.id,state:all.every(row=>row.passed)?'passed':'failed',checks:all,baseline:result.baseline,limitation:spec.limitation};
    } catch {
      return {id:spec.id,state:'failed',checks:[...binding,{id:'evidence-schema',passed:false}],baseline:null,limitation:spec.limitation};
    }
  });
  return {schemaVersion:1,runId:manifest.runId,criteriaVersion,scope:'offline-sdk-core-flows',
    passed:checks.every(row=>row.passed)&&scenarios.every(row=>row.state==='passed'),releaseAccepted:false,
    checks,scenarios,requirements:allRequirements.map(id=>({id,fullAcceptance:'not-executed',offlineScenarios:catalog.filter(row=>row.requirements.some(requirement=>requirement===id)).map(row=>row.id)})),
    limitations:['未执行真实模型、真实平台、付费测试或两小时观察','局部SDK场景不等于整个修正版验收通过']};
}

export function auditDirectory(directory:string) {
  const manifest=readJson(join(directory,'manifest.json')),completion=readJson(join(directory,'completion.json'));
  const artifacts=new Map<string,unknown>();
  for (const spec of catalog) {
    try {artifacts.set(spec.id,readJson(join(directory,spec.id+'.json')));} catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code==='ENOENT')) throw error;
    }
  }
  const result=auditAcceptance(manifest,completion,artifacts),driverHash=fingerprint('driver');
  return {...result,auditedAt:new Date().toISOString(),auditor:{criteriaVersion,driverHash,
    mode:manifestSchema.parse(manifest).driverHash===driverHash?'original-driver':'re-audit-different-driver'}};
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href===import.meta.url) {
  const [directory,...extra]=process.argv.slice(2);
  if (!directory || extra.length) throw new Error('Usage: node scripts/acceptance/audit.ts <run-directory>');
  const result=auditDirectory(resolve(directory));
  // Re-audits append a new report; they do not overwrite the original verdict.
  const name='audit-'+new Date().toISOString().replaceAll(':','-')+'.json';
  saveJson(join(resolve(directory),name),result);
  console.log(JSON.stringify({runId:result.runId,passed:result.passed,report:join(resolve(directory),name)}));
  if (!result.passed) process.exitCode=1;
}
