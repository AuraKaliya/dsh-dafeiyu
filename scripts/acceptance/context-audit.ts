import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {z} from 'zod';
import {repository,hash} from './io.mjs';
import {databaseEvidenceSchema,requestMeasurementSchema} from './schema.ts';

/** Independent comparison: material must actually appear in admitted requests and be delivered. */
export function auditContextFolding(raw:unknown){
  const baseline=z.object({totalInputBytes:z.number(),repeatedBodies:z.number(),allRequests:z.number(),taskRequests:z.number(),sent:z.string()}).parse(JSON.parse(readFileSync(join(repository,'tests/fixtures/acceptance/context-baseline.json'),'utf8')));
  const data=z.object({taskInputs:z.array(z.string()),requests:z.array(requestMeasurementSchema),database:databaseEvidenceSchema,capacity:z.object({maxTokens:z.number()}),
    inputUsage:z.object({tokens:z.number().nullable(),inputContext:z.object({measuredCalls:z.number(),totalBytes:z.number(),byEnvironment:z.record(z.string(),z.object({calls:z.number()}))})})}).parse(raw);
  const checks:{id:string;passed:boolean}[]=[],check=(id:string,passed:boolean)=>checks.push({id,passed});
  const bodies=Array.from({length:12},(_,index)=>`MATERIAL_${String(index).padStart(2,'0')}_`+'证'.repeat(3988));
  const repeated=data.taskInputs.reduce((sum,input)=>sum+bodies.filter(body=>input.includes(body)).length,0),bytes=data.requests.reduce((sum,row)=>sum+row.inputBytes,0);
  check('all-material-first-exposed',bodies.every((body,index)=>data.taskInputs[index+1]?.includes(body)));
  check('constraints-retained',data.taskInputs.every(input=>['纠正','禁止修改文件','待办'].every(text=>input.includes(text))));
  check('folding-not-omission',data.taskInputs.some(input=>input.includes('archived-tool-result'))&&repeated<baseline.repeatedBodies);
  check('same-requests-with-less-input',data.requests.length===baseline.allRequests&&data.taskInputs.length===baseline.taskRequests&&bytes<baseline.totalInputBytes);
  check('no-original-tool-replay',data.database.operations.filter(op=>op.action==='dsh_tool_read'&&op.outcome?.status==='succeeded').length===12&&data.database.operations.filter(op=>op.action==='dsh_result_read').length===1);
  check('same-delivered-report',data.database.deliveries.length===1&&data.database.deliveries[0]?.state==='sent'&&!!data.database.deliveries[0]?.receipt&&data.database.deliveries[0]?.body===baseline.sent);
  check('million-capacity',data.capacity.maxTokens===1000000);
  const context=data.inputUsage.inputContext;
  const measurement=z.object({stage:z.literal('sdk-pre-adapter'),bytes:z.number(),inputHash:z.string()});
  const audit=z.object({preflight:z.array(z.object({sessionId:z.string().nullable(),bytes:z.number(),inputHash:z.string()})),database:z.object({inputMeasurements:z.array(z.object({request_id:z.string(),body:measurement}))})}).parse(raw);
  const recorded=audit.database.inputMeasurements.map(row=>({sessionId:data.database.requests.find(request=>request.id===row.request_id)?.body.sessionId??null,bytes:row.body.bytes,inputHash:row.body.inputHash}));
  const sorted=(rows:typeof recorded)=>rows.map(row=>JSON.stringify(row)).sort();
  check('input-accounting',data.database.requests.length===data.requests.length&&data.database.requests.every(row=>row.settlement!==null)&&context.measuredCalls===data.requests.length&&context.totalBytes===recorded.reduce((sum,row)=>sum+row.bytes,0)&&context.byEnvironment['deterministic-test']?.calls===data.requests.length
    &&new Set(audit.database.inputMeasurements.map(row=>row.request_id)).size===data.requests.length&&hash(sorted(recorded))===hash(sorted(audit.preflight)));
  check('unknown-cost-is-not-zero',data.inputUsage.tokens===null);
  return {checks,baseline:{kind:'offline-context-byte-comparison',beforeBytes:baseline.totalInputBytes,afterBytes:bytes,preAdapterBytes:context.totalBytes,beforeRepeatedBodies:baseline.repeatedBodies,afterRepeatedBodies:repeated,paidCalls:false,monetaryCost:null}};
}
