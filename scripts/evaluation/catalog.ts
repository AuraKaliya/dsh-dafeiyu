import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { z } from 'zod';
export const sha256=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
export const FROZEN_SUITE_HASH='1598c1d0507495005e6762158952f38ea7dfaaa3a5bf2cc4fb40a8346972711a';
const text=z.string().min(1).max(8000),texts=z.array(text).max(64);
const receipt=z.strictObject({status:z.enum(['failed','partial']),effects:z.enum(['none','unknown']),completeness:z.enum(['partial','unknown'])});
export const BoundarySchema=z.strictObject({id:z.string().regex(/^B\d{2}$/),title:text,pgc:texts,
  fixture:z.strictObject({kind:z.enum(['empty-persona','text-observation','untrusted-document','adopted-preference','trusted-input-sequence','explicit-task','partial-data-task','task-with-preference','failed-read','shared-root-evidence','two-scopes','conflicting-self-note']),facts:texts.optional(),resource:text.optional(),allowedActions:texts.optional(),receipt:receipt.optional(),
    entry:z.strictObject({id:text,content:text,state:z.literal('adopted'),evidence:text}).optional(),privateFact:text.optional(),publicScope:text.optional(),privateScope:text.optional(),exportAllowed:z.literal(false).optional()}),
  prompts:z.strictObject({neutral:texts,pressure:texts,paraphrase:texts}),program:texts,semantic:texts,blockers:texts});
export type BoundarySample=z.infer<typeof BoundarySchema>;
export const HistorySchema=z.strictObject({id:z.string().regex(/^H\d{2}$/),title:text,pgc:texts,fixtureKind:z.enum(['task-ledger','versioned-source','stage-and-task','isolated-identities','operation-receipts','partial-coverage']),history:texts,privateFixture:text.optional(),question:text,facts:texts,mandatory:texts,forbidden:texts,minCompactions:z.number().int().min(1).max(2)});
export type HistorySample=z.infer<typeof HistorySchema>;
const suiteSchema=z.object({schemaVersion:z.literal(1),suiteId:text,status:z.literal('deferred-by-user'),executionAuthorized:z.literal(false),budget:z.object({approvedCny:z.null()}),
  protocol:z.object({boundaryVariants:z.tuple([z.literal('neutral'),z.literal('pressure'),z.literal('paraphrase')]),continuityConditions:z.tuple([z.literal('full'),z.literal('compressed'),z.literal('compressed-restarted')]),repeats:z.literal(3),total:z.literal(162),orderSeed:text}),
  boundaryScenarios:z.array(BoundarySchema).length(12),continuityHistories:z.array(HistorySchema).length(6)});
const base={id:text,sampleId:text,repeat:z.number().int().min(1).max(3),status:z.literal('not-run'),reviewId:z.string().regex(/^REVIEW-\d{3}$/)};
export const EvaluationCaseSchema=z.discriminatedUnion('kind',[z.strictObject({...base,kind:z.literal('boundary'),condition:z.enum(['neutral','pressure','paraphrase'])}),z.strictObject({...base,kind:z.literal('continuity'),condition:z.enum(['full','compressed','compressed-restarted'])})]);
export type EvaluationCase=z.infer<typeof EvaluationCaseSchema>;
const manifestSchema=z.strictObject({schemaVersion:z.literal(1),suiteId:text,suiteSha256:z.string().length(64),foundationFile:z.literal('profiles/persona.foundation.md'),foundationRuntimeHash:z.string().length(64),cases:z.array(EvaluationCaseSchema).length(162)});
function frozen<T>(value:T):T{if(value&&typeof value==='object'){for(const child of Object.values(value))frozen(child);Object.freeze(value);}return value;}
function read(root:string,file:string){const bytes=readFileSync(resolve(root,file));if(bytes.length>2*1024**2)throw new Error('EVALUATION_SOURCE_TOO_LARGE');return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}
/** Frozen v1 inputs remain read-only. Assessment criteria are never part of modelInput(). */
export class EvaluationCatalog {
  readonly suite:z.infer<typeof suiteSchema>;readonly manifest:z.infer<typeof manifestSchema>;readonly sourceFiles:Readonly<Record<string,string>>;
  readonly suiteHash:string;readonly manifestHash:string;readonly foundationHash:string;
  constructor(repository:string){const suiteText=read(repository,'evaluation/phase1g/suite.v1.json'),manifestText=read(repository,'evaluation/phase1g/manifest.v1.json'),foundation=read(repository,'profiles/persona.foundation.md');
    this.suiteHash=sha256(suiteText);this.manifestHash=sha256(manifestText);this.foundationHash=sha256(foundation.trim());if(this.suiteHash!==FROZEN_SUITE_HASH)throw new Error('EVALUATION_FROZEN_SUITE_CHANGED');
    this.suite=frozen(suiteSchema.parse(JSON.parse(suiteText)));this.manifest=frozen(manifestSchema.parse(JSON.parse(manifestText)));if(this.manifest.suiteId!==this.suite.suiteId||this.manifest.suiteSha256!==this.suiteHash||this.manifest.foundationRuntimeHash!==this.foundationHash)throw new Error('EVALUATION_FROZEN_MANIFEST_CHANGED');
    const expanded:{id:string;sampleId:string;kind:'boundary'|'continuity';condition:string;repeat:number}[]=[];
    for(const sample of this.suite.boundaryScenarios)for(const condition of this.suite.protocol.boundaryVariants)for(let repeat=1;repeat<=3;repeat++)expanded.push({id:`${sample.id}-${condition}-${repeat}`,sampleId:sample.id,kind:'boundary',condition,repeat});
    for(const sample of this.suite.continuityHistories)for(const condition of this.suite.protocol.continuityConditions)for(let repeat=1;repeat<=3;repeat++)expanded.push({id:`${sample.id}-${condition}-${repeat}`,sampleId:sample.id,kind:'continuity',condition,repeat});
    expanded.sort((a,b)=>sha256(this.suite.protocol.orderSeed+a.id).localeCompare(sha256(this.suite.protocol.orderSeed+b.id)));
    if(new Set(expanded.map(c=>c.id)).size!==162||expanded.some((c,i)=>{const expected=this.manifest.cases[i];return !expected||Object.entries(c).some(([k,v])=>expected[k as keyof EvaluationCase]!==v)||expected.reviewId!==`REVIEW-${String(i+1).padStart(3,'0')}`;}))throw new Error('EVALUATION_CASE_MATRIX_CHANGED');
    this.sourceFiles=Object.freeze({'sources/suite.v1.json':suiteText,'sources/manifest.v1.json':manifestText,'sources/persona.foundation.md':foundation});}
  case(id:string){const item=this.manifest.cases.find(c=>c.id===id);if(!item)throw new Error('EVALUATION_CASE_UNKNOWN');return item;}
  boundary(id:string){const sample=this.suite.boundaryScenarios.find(s=>s.id===id);if(!sample)throw new Error('EVALUATION_SAMPLE_UNKNOWN');return sample;}
  history(id:string){const sample=this.suite.continuityHistories.find(s=>s.id===id);if(!sample)throw new Error('EVALUATION_SAMPLE_UNKNOWN');return sample;}
  modelInput(id:string){const item=this.case(id);return item.kind==='boundary'?{prompts:[...this.boundary(item.sampleId).prompts[item.condition]]}:{history:[...this.history(item.sampleId).history],question:this.history(item.sampleId).question};}
  criteria(id:string){const item=this.case(id);if(item.kind==='boundary'){const sample=this.boundary(item.sampleId);return {program:[...sample.program],semantic:[...sample.semantic],blockers:[...sample.blockers]};}const sample=this.history(item.sampleId);return {program:['按实际条件核验DSH压缩／重启及来源边界'],semantic:[...sample.facts,...sample.mandatory],blockers:[...sample.forbidden]};}
  summary(){return {suiteId:this.suite.suiteId,suiteHash:this.suiteHash,manifestHash:this.manifestHash,foundationHash:this.foundationHash,samples:18,cases:162,boundary:108,continuity:54,realExecutionAuthorized:false};}
}
