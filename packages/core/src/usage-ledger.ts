import type {DatabaseSync} from 'node:sqlite';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {ModelUsagePhaseSchema,ModelUsageWorkTypeSchema,ModelUsageBreakdownSchema,ModelUsageOverviewSchema} from '@dafeiyu/contracts';
import type {ModelUsagePhase,ModelUsageOverview} from '@dafeiyu/contracts';
import type {UsageStart,UsageSettlement,UsageReceipt,UsageRecorder} from './usage.js';

const counter=z.number().int().nonnegative().safe(),identifier=z.string().min(1).max(240);
const startSchema=z.strictObject({id:identifier,runId:z.uuid().nullable(),phase:ModelUsagePhaseSchema,workType:ModelUsageWorkTypeSchema.default('unassigned'),startedAt:z.iso.datetime(),provider:identifier,model:identifier,sessionId:identifier.nullable(),external:z.boolean().optional(),marker:z.boolean().optional()});
const receiptSchema=z.object({id:identifier,tokens:counter.nullable(),durationMs:counter,breakdown:ModelUsageBreakdownSchema.optional()});
const settlementSchema=z.strictObject({state:z.enum(['completed','failed','cancelled','interrupted']),finishedAt:z.iso.datetime(),reason:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable(),receipt:receiptSchema});
type Row={start:z.infer<typeof startSchema>;settlement:z.infer<typeof settlementSchema>|null};

export function addModelUsageSchema(db:DatabaseSync){db.exec(`CREATE TABLE model_requests(id TEXT PRIMARY KEY,run_id TEXT REFERENCES runs(id),body TEXT NOT NULL,settlement TEXT);
CREATE INDEX model_requests_run ON model_requests(run_id);
CREATE TRIGGER model_request_binding_immutable BEFORE UPDATE OF id,run_id,body ON model_requests BEGIN SELECT RAISE(ABORT,'Immutable model request');END;
CREATE TRIGGER model_request_settlement_immutable BEFORE UPDATE OF settlement ON model_requests WHEN OLD.settlement IS NOT NULL BEGIN SELECT RAISE(ABORT,'Immutable model settlement');END;
CREATE TRIGGER model_request_retain BEFORE DELETE ON model_requests BEGIN SELECT RAISE(ABORT,'Retain model requests');END;`);}

/** Requests remain countable before a response and after a Run has completed. No prompt or credential is stored. */
export class UsageLedger implements UsageRecorder {
  private overview:ModelUsageOverview|undefined;
  constructor(private readonly db:DatabaseSync,private readonly atomic:<T>(work:()=>T)=>T){}
  private resolveRun(input:UsageStart):string|null{
    if(input.runId&&this.db.prepare('SELECT id FROM runs WHERE id=?').get(input.runId))return input.runId;
    const workItem=input.workItemId??input.runId;
    if(workItem){const row=this.db.prepare("SELECT run_id FROM execution_requests WHERE producer='conversation' AND request_id=?").get(workItem);if(row?.run_id)return String(row.run_id);}
    if(input.sessionId){const row=this.db.prepare("SELECT id FROM runs WHERE json_extract(snapshot,'$.sessionId')=? ORDER BY rowid DESC LIMIT 1").get(input.sessionId);if(row)return String(row.id);}
    return null;
  }
  private workType(runId:string|null):z.infer<typeof ModelUsageWorkTypeSchema>{if(!runId)return 'unassigned';
    const row=this.db.prepare("SELECT json_extract(r.definition,'$.scope.kind') scope,json_extract(r.definition,'$.policyId') policy,json_extract(r.definition,'$.origin.producerId') producer,json_extract(q.body,'$.messageSource.kind') motivation FROM runs r JOIN execution_requests q ON q.id=r.request_key WHERE r.id=?").get(runId);
    if(!row)return 'unassigned';if(row.scope==='conversation')return 'conversation';if(String(row.policy).includes('maintenance'))return 'maintenance';if(row.producer==='activity'||row.motivation==='self-exploration')return 'exploration';return 'owner-task';}
  begin(input:UsageStart){const runId=this.resolveRun(input);this.insert(startSchema.parse({id:input.id,runId,phase:input.phase??'other',workType:input.workType??this.workType(runId),startedAt:input.startedAt,provider:input.provider,model:input.model,sessionId:input.sessionId??null}));}
  private insert(value:z.infer<typeof startSchema>){this.atomic(()=>{const body=JSON.stringify(value),old=this.db.prepare('SELECT body FROM model_requests WHERE id=?').get(value.id);
    if(old){if(old.body!==body)throw new Error('USAGE_REQUEST_CONFLICT');return;}
    this.db.prepare('INSERT INTO model_requests VALUES(?,?,?,NULL)').run(value.id,value.runId,body);this.overview=undefined;});}
  finish(id:string,raw:UsageSettlement){const value=settlementSchema.parse(raw);if(value.receipt.id!==id)throw new Error('USAGE_REQUEST_MISMATCH');
    if(value.receipt.breakdown&&value.receipt.tokens!==value.receipt.breakdown.totalTokens)throw new Error('USAGE_TOTAL_MISMATCH');
    this.atomic(()=>{const old=this.db.prepare('SELECT settlement FROM model_requests WHERE id=?').get(id);if(!old)throw new Error('USAGE_REQUEST_MISSING');const body=JSON.stringify(value);
      if(old.settlement!==null){if(old.settlement!==body)throw new Error('USAGE_SETTLEMENT_CONFLICT');return;}
      this.db.prepare('UPDATE model_requests SET settlement=? WHERE id=? AND settlement IS NULL').run(body,id);this.overview=undefined;});}
  external(runId:string,receipt:UsageReceipt){const run=this.db.prepare('SELECT id FROM runs WHERE id=?').get(runId);if(!run)throw new Error('RUN_NOT_FOUND');
    const id='external:'+createHash('sha256').update(runId+':'+receipt.id).digest('hex'),old=this.db.prepare('SELECT body,settlement FROM model_requests WHERE id=?').get(id);
    const normalized=receiptSchema.parse({...receipt,id});if(old?.settlement){const saved=settlementSchema.parse(JSON.parse(String(old.settlement)));if(JSON.stringify(saved.receipt)!==JSON.stringify(normalized))throw new Error('USAGE_SETTLEMENT_CONFLICT');return;}
    const at=old?startSchema.parse(JSON.parse(String(old.body))).startedAt:new Date().toISOString();
    this.insert({id,runId,phase:'external',workType:this.workType(runId),startedAt:at,provider:receipt.provider??'external',model:receipt.model??'external',sessionId:receipt.sessionId??null,external:true,...(receipt.marker?{marker:true}:{})});
    this.finish(id,{state:'completed',finishedAt:at,reason:receipt.tokens===null?'EXTERNAL_USAGE_UNAVAILABLE':null,receipt:{id:normalized.id,tokens:normalized.tokens,durationMs:normalized.durationMs,...(normalized.breakdown?{breakdown:normalized.breakdown}:{})}});
  }
  recover(){let count=0;for(const row of this.db.prepare('SELECT id,body FROM model_requests WHERE settlement IS NULL').all()){const start=startSchema.parse(JSON.parse(String(row.body)));
    this.finish(String(row.id),{state:'interrupted',finishedAt:new Date().toISOString(),reason:'PROCESS_INTERRUPTED',receipt:{id:String(row.id),tokens:null,durationMs:Math.max(0,Date.now()-Date.parse(start.startedAt))}});count++;}return count;}
  rows(runId?:string):Row[]{return (runId===undefined?this.db.prepare('SELECT body,settlement FROM model_requests').all():this.db.prepare('SELECT body,settlement FROM model_requests WHERE run_id=?').all(runId)).map(row=>({start:startSchema.parse(JSON.parse(String(row.body))),settlement:row.settlement===null?null:settlementSchema.parse(JSON.parse(String(row.settlement)))}));}
  private totals(rows:readonly Row[]){const counted=rows.filter(row=>!row.start.marker),pending=counted.filter(row=>!row.settlement).length,unknownCalls=counted.filter(row=>row.settlement?.receipt.tokens===null).length;
    const details=rows.flatMap(row=>row.settlement?.receipt.breakdown?[row.settlement.receipt.breakdown]:[]),sum=(key:keyof z.infer<typeof ModelUsageBreakdownSchema>)=>details.reduce((n,row)=>n+row[key],0),knownTokens=rows.reduce((n,row)=>n+(row.settlement?.receipt.tokens??0),0);
    return {calls:counted.length,pending,unknownCalls,knownTokens,tokens:pending||unknownCalls?null:knownTokens,breakdown:{inputTokens:sum('inputTokens'),cacheReadTokens:sum('cacheReadTokens'),cacheWriteTokens:sum('cacheWriteTokens'),outputTokens:sum('outputTokens'),totalTokens:sum('totalTokens')}};}
  summary(runId?:string):ModelUsageOverview {if(runId===undefined&&this.overview)return structuredClone(this.overview);const rows=this.rows(runId),times=rows.map(row=>row.start.startedAt).sort(),byPhase:Partial<Record<ModelUsagePhase,ReturnType<UsageLedger['totals']>>>={};
    for(const phase of ModelUsagePhaseSchema.options){const matching=rows.filter(row=>row.start.phase===phase);if(matching.length)byPhase[phase]=this.totals(matching);}
    const byWorkType:Partial<Record<z.infer<typeof ModelUsageWorkTypeSchema>,ReturnType<UsageLedger['totals']>>>={};for(const type of ModelUsageWorkTypeSchema.options){const matching=rows.filter(row=>row.start.workType===type);if(matching.length)byWorkType[type]=this.totals(matching);}
    const unknownReasons:Record<string,number>={};for(const row of rows)if(!row.start.marker&&row.settlement?.receipt.tokens===null){const reason=row.settlement.reason??'USAGE_REASON_UNAVAILABLE';unknownReasons[reason]=(unknownReasons[reason]??0)+1;}
    const result=ModelUsageOverviewSchema.parse({...this.totals(rows),scope:'observed-local-requests',since:times[0]??null,lastAt:times.at(-1)??null,unassignedCalls:rows.filter(row=>!row.start.runId&&!row.start.marker).length,byPhase,byWorkType,unknownReasons,legacyHistory:'not-reconstructed'});
    if(runId===undefined)this.overview=structuredClone(result);return result;
  }
}
