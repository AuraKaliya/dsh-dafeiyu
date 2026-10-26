import { redactContent, redactJson } from '#dafeiyu/contracts';
import { z } from 'zod';
/** Only public content reaches DSH JSONL; transport reasoning and replay stay out. */
export async function* visibleStream(input) {
    const visible = new Map(), seen = new Set();
    for await (const chunk of input) {
        if (chunk.type === 'block-start') {
            if (seen.has(chunk.index))
                throw new Error('INVALID_MODEL_STREAM');
            seen.add(chunk.index);
            if (chunk.blockType === 'reasoning')
                continue;
            if (chunk.blockType !== 'text' && chunk.blockType !== 'tool-call')
                throw new Error('MODEL_PERSISTENCE_POLICY_UNSUPPORTED');
            const entry = { index: visible.size, kind: chunk.blockType };
            visible.set(chunk.index, entry);
            yield { type: 'block-start', index: entry.index, blockType: entry.kind };
        }
        else if (chunk.type === 'reasoning-delta') {
            continue;
        }
        else if (chunk.type === 'text-delta' || chunk.type === 'tool-call-delta') {
            const entry = visible.get(chunk.index);
            if (!entry || entry.kind !== (chunk.type === 'text-delta' ? 'text' : 'tool-call'))
                throw new Error('INVALID_MODEL_STREAM');
            // Commit public text/arguments as a complete block, so a known secret split across
            // deltas cannot reach the persistent transcript before inspection.
        }
        else if (chunk.type === 'block-end') {
            if (chunk.block.type === 'reasoning')
                continue;
            const entry = visible.get(chunk.index);
            if (!entry || chunk.block.type !== entry.kind)
                throw new Error('INVALID_MODEL_STREAM');
            if (chunk.block.type === 'text') {
                const text = redactContent(chunk.block.text).value;
                yield { type: 'text-delta', index: entry.index, text };
                yield { type: 'block-end', index: entry.index, block: { type: 'text', text } };
            }
            else if (chunk.block.type === 'tool-call') {
                let args;
                try {
                    args = z.json().parse(JSON.parse(chunk.block.arguments));
                }
                catch {
                    throw new Error('INVALID_MODEL_ARGUMENTS');
                }
                if (redactJson(args).redacted)
                    throw new Error('PRIVATE_INPUT_REJECTED');
                yield { type: 'tool-call-delta', index: entry.index, id: chunk.block.id, name: chunk.block.name, argumentsDelta: chunk.block.arguments };
                yield { type: 'block-end', index: entry.index, block: { type: 'tool-call', id: chunk.block.id, name: chunk.block.name, arguments: chunk.block.arguments } };
            }
        }
        else if (chunk.type === 'usage')
            yield { type: 'usage', usage: chunk.usage };
        else {
            const reason = chunk.reason;
            if (reason.kind === 'error' || reason.kind === 'aborted') {
                const code = reason.failure.code.toUpperCase(), status = reason.failure.status;
                yield { type: 'finish', reason: { kind: reason.kind, failure: { code: /^[A-Z][A-Z0-9_]{0,63}$/.test(code) ? code : 'MODEL_INCOMPLETE', message: 'Model did not complete',
                            ...(typeof status === 'number' && Number.isInteger(status) && status >= 100 && status < 600 ? { status } : {}) } } };
            }
            else
                yield { type: 'finish', reason };
        }
    }
}
