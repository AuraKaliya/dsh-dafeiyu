import assert from 'node:assert/strict';
import type { Session } from '@deepseek-ai/dsh-session';
import type { Message } from '@deepseek-ai/dsh-llm';
import { readSummaryArtifacts,resolveFragmentView,expandedFragmentProof } from '@dafeiyu/core';
import { z } from 'zod';
import { SourceDependencySchema } from '@dafeiyu/contracts';

/** Tests inspect private proofs explicitly instead of expecting them in the prompt. */
export function checkpointProof(session:Session,message:Message){
  assert.equal(message.role,'user');assert.ok(message.source.kind==='compact-checkpoint'||message.source.kind==='dafeiyu-summary-view');
  const body:unknown=JSON.parse(message.content.filter(b=>b.type==='text').map(b=>b.text).join('\n'));
  const compact=z.object({schemaVersion:z.literal(3),ref:z.string()}).safeParse(body);
  assert.ok(compact.success);
  const id=message.source.kind==='compact-checkpoint'||message.source.kind==='dafeiyu-summary-view'?message.source.compactionId:'';
  const manifest=readSummaryArtifacts(session).find(e=>e.type==='plugin:dafeiyu/summary-manifest'&&e.data.compactionId===id);
  assert.ok(manifest&&manifest.type==='plugin:dafeiyu/summary-manifest');
  const view=resolveFragmentView(session,compact.data.ref,{agentId:manifest.data.agentId,route:manifest.data.route});assert.ok(view);
  return expandedFragmentProof(view);
}
