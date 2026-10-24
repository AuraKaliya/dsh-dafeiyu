import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
const base=resolve('evaluation/phase1g'),raw=await readFile(base+'/suite.v1.json'),suite=JSON.parse(raw);
assert.equal(suite.schemaVersion,1);assert.equal(suite.executionAuthorized,false);assert.equal(suite.status,'deferred-by-user');assert.equal(suite.budget.approvedCny,null);
assert.equal(suite.boundaryScenarios.length,12);assert.equal(suite.continuityHistories.length,6);
const hash=value=>createHash('sha256').update(value).digest('hex'),cases=[];
for(const sample of suite.boundaryScenarios){assert.ok(sample.fixture&&sample.program.length&&sample.semantic.length&&sample.blockers.length);for(const variant of suite.protocol.boundaryVariants){assert.ok(sample.prompts[variant]?.length);for(let repeat=1;repeat<=3;repeat++)cases.push({id:`${sample.id}-${variant}-${repeat}`,kind:'boundary',sampleId:sample.id,condition:variant,repeat,status:'not-run'});}}
for(const sample of suite.continuityHistories){assert.ok(sample.history.length>=6&&sample.question&&sample.facts.length&&sample.mandatory.length);for(const condition of suite.protocol.continuityConditions)for(let repeat=1;repeat<=3;repeat++)cases.push({id:`${sample.id}-${condition}-${repeat}`,kind:'continuity',sampleId:sample.id,condition,repeat,status:'not-run'});}
assert.equal(cases.length,162);assert.equal(new Set(cases.map(c=>c.id)).size,162);
cases.sort((a,b)=>hash(suite.protocol.orderSeed+a.id).localeCompare(hash(suite.protocol.orderSeed+b.id)));
const foundation=(await readFile('profiles/persona.foundation.md','utf8')).trim();
const manifest={schemaVersion:1,suiteId:suite.suiteId,suiteSha256:hash(raw),foundationFile:'profiles/persona.foundation.md',foundationRuntimeHash:hash(foundation),cases:cases.map((c,i)=>({...c,reviewId:`REVIEW-${String(i+1).padStart(3,'0')}`}))};
if(process.argv[2]==='--freeze')await writeFile(base+'/manifest.v1.json',JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
else assert.deepEqual(JSON.parse(await readFile(base+'/manifest.v1.json','utf8')),manifest);
console.log(JSON.stringify({samples:18,cases:cases.length,boundary:108,continuity:54,suiteSha256:manifest.suiteSha256,realModelCalls:0,executionAuthorized:false,passed:true}));
