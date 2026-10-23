import type { SessionEvent } from '@deepseek-ai/dsh-session';
import { redactContent, redactJson } from '@dafeiyu/contracts';
import type { Json } from '@dafeiyu/contracts';

/** An explicit export projection. Never serialize a DSH event wholesale. */
export function projectSession(event: SessionEvent) {
  let text: string;
  let kind: string;
  let omittedBlocks = 0;
  let interrupted = false;
  switch (event.type) {
    case 'user/message': {
      const parts = event.data.content.filter(block => block.type === 'text');
      omittedBlocks = event.data.content.length - parts.length;
      text = parts.map(block => block.text).join('\n');
      kind = event.data.source.kind === 'user' ? 'user-text' : 'derived-context';
      break;
    }
    case 'assistant/message': {
      const parts = event.data.message.content.filter(block => block.type === 'text');
      omittedBlocks = event.data.message.content.length - parts.length;
      text = parts.map(block => block.text).join('\n'); kind = 'assistant-text'; interrupted = event.data.interrupted === true;
      break;
    }
    case 'tool/result': {
      const parts = event.data.message.content.filter(block => block.type === 'text');
      omittedBlocks = event.data.message.content.length - parts.length;
      text = parts.map(block => block.text).join('\n'); kind = event.data.message.isError ? 'tool-error-text' : 'tool-result-text';
      break;
    }
    case 'turn/end': text = JSON.stringify({ turn: event.data.turn, outcome: event.data.reason.kind }); kind = 'turn-outcome'; break;
    default: return null;
  }
  const clean = redactContent(text);
  return { kind, text: clean.value, redacted: clean.redacted, omittedBlocks, interrupted, seq: event.seq, time: event.time };
}

export function eventMetadata(input: {
  seq: number; type: string; plugin: string; pluginVersion: string; occurredAt: string; recordedAt: string;
  traceId: string; operationId: string; data: Readonly<Record<string, Json>>;
}) {
  const data = redactJson(input.data);
  return { seq: input.seq, type: input.type, plugin: input.plugin, pluginVersion: input.pluginVersion,
    occurredAt: input.occurredAt, recordedAt: input.recordedAt, traceId: input.traceId, operationId: input.operationId,
    data: data.value, redacted: data.redacted };
}
