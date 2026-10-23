import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadProfile } from '@dafeiyu/memory/retrieval-profile';

const raw=await readFile('benchmarks/embedding/dataset.json');
const dataset=JSON.parse(raw),result=JSON.parse(await readFile('docs/results/memory-phase-2.json','utf8'));
assert.equal(result.datasetSha256,createHash('sha256').update(raw).digest('hex'));
assert.equal(result.profile,loadProfile().hash);
assert.equal(result.projectVersion,JSON.parse(await readFile('package.json','utf8')).version);
assert.equal(result.memoryVersion,JSON.parse(await readFile('packages/memory/package.json','utf8')).version);
const queries=new Map(dataset.queries.filter(query=>query.mode==='normal').map(query=>[query.id,query]));
const allowed=new Set(dataset.documents.filter(doc=>doc.scope==='test'&&!doc.deleted&&doc.status==='active').map(doc=>doc.id));
assert.equal(result.normalQueries,queries.size);
for(const evaluation of Object.values(result.evaluations)){
  assert.equal(evaluation.rows.length,queries.size);
  assert.deepEqual(new Set(evaluation.rows.map(row=>row.id)),new Set(queries.keys()));
  for(const row of evaluation.rows){
    assert.deepEqual(row.relevant,queries.get(row.id).relevant);
    assert.equal(row.ranked.length,new Set(row.ranked).size);
    assert.ok(row.ranked.every(id=>allowed.has(id)));
  }
  const answered=evaluation.rows.filter(row=>row.relevant.length);
  const recall=answered.reduce((sum,row)=>sum+row.relevant.filter(id=>row.ranked.slice(0,5).includes(id)).length/row.relevant.length,0)/answered.length;
  assert.ok(Math.abs(recall-evaluation.recall5)<1e-12);
  assert.equal(answered.length,evaluation.answerable);
}
assert.equal(result.checks.cacheRepeatComputed,0);
assert.equal(result.checks.deletedRebuildCount,0);
assert.ok(result.checks.deletedContentPreserved&&result.checks.tokenCoverage&&result.checks.overlongQueryRejected&&result.checks.scopeFilter);
assert.ok(result.checks.tailChunkStart>512&&result.checks.tailChunkEnd>result.checks.tailChunkStart);
console.log(JSON.stringify({verifiedStrategies:3,normalQueries:queries.size,profile:result.profile,checks:result.checks},null,2));
