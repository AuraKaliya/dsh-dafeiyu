import {DatabaseSync} from 'node:sqlite';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import type {GenerateOptions} from '@deepseek-ai/dsh-llm';
import {captureEvidence} from '../scripts/acceptance/io.mjs';
import {API_VERSION, RELEASE_VERSION} from '@dafeiyu/contracts';

export function captureAcceptance(id: string, evidence: unknown): void {
  captureEvidence(id, RELEASE_VERSION, API_VERSION, evidence);
}

/** Copies synthetic program facts before managed test cleanup. No production data is opened. */
export function acceptanceDatabase(root: string) {
  const db = new DatabaseSync(join(root, 'data/core/runtime.sqlite'), {readOnly: true});
  const decode = (value: unknown): unknown => typeof value === 'string' ? JSON.parse(value) : value;
  try {
    return {
      runs: db.prepare('SELECT id,state,definition,result FROM runs').all().map(row => ({...row, definition: decode(row.definition), result: decode(row.result)})),
      deliveries: db.prepare('SELECT run_id,state,receipt,body,anchor FROM native_deliveries').all().map(row => ({...row, anchor: decode(row.anchor)})),
      requests: db.prepare('SELECT id,body,settlement FROM model_requests').all().map(row => ({...row, body: decode(row.body), settlement: decode(row.settlement)})),
      inputMeasurements:db.prepare('SELECT request_id,body FROM model_request_inputs').all().map(row=>({...row,body:decode(row.body)})),
      operations: db.prepare('SELECT id,action,outcome FROM run_operations').all().map(row => ({...row, outcome: decode(row.outcome)})),
      recoveryEvents: db.prepare("SELECT body FROM runtime_outbox WHERE json_extract(body,'$.type') LIKE 'native.delivery.recovery.%' ORDER BY ordinal").all().map(row=>decode(row.body)),
      sources:db.prepare("SELECT run_id runId,json_extract(body,'$.messageSource.inboundId') inboundId,json_extract(body,'$.messageSource.conversation') target FROM execution_requests WHERE run_id IS NOT NULL AND json_extract(body,'$.messageSource.schemaVersion')=1").all().map(row=>({...row,target:decode(row.target)})),
    };
  } finally { db.close(); }
}

/** Byte measurements only. Scripted providers have no billable or measured token usage. */
export function requestMeasurements(requests: readonly GenerateOptions[]) {
  const seen = new Set<string>();
  return requests.map(request => {
    let toolResultBytes = 0, repeatedToolResultBytes = 0;
    for (const message of request.messages) if (message.role === 'tool') {
      const text = JSON.stringify(message.content), bytes = Buffer.byteLength(text), key = createHash('sha256').update(text).digest('hex');
      toolResultBytes += bytes;
      if (seen.has(key)) repeatedToolResultBytes += bytes;
      seen.add(key);
    }
    return {sessionId: request.sessionId ?? null, inputBytes: Buffer.byteLength(JSON.stringify({messages: request.messages, tools: request.tools ?? [], toolHistory: request.toolHistory ?? null})),
      toolResultBytes, repeatedToolResultBytes};
  });
}
