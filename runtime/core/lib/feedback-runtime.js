import { FeedbackMetaSchema, FEEDBACK_RETIRED_TEXT } from '#dafeiyu/contracts';
import { priceRetirement } from './compaction-runtime.js';
/** Replaces only core-tagged tool results; preserves tool-call pairing and other plugins' nodes. */
export class FeedbackRuntime {
    scope;
    validate;
    agent;
    item;
    constructor(scope, validate) {
        this.scope = scope;
        this.validate = validate;
        scope.systemPrompt.context({ name: 'dafeiyu:feedback-guard:v1', order: 9999, required: true, interpolate: false, text: () => { this.retire(); return ''; } });
    }
    begin(item, agent) { this.item = item; this.agent = agent; }
    end() { this.item = undefined; }
    retire() {
        if (!this.item || !this.agent)
            return;
        const session = this.agent.session, events = new Map(session.snapshotEvents().map(e => [e.seq, e]));
        for (const seq of [...session.surface.nodes]) {
            const event = events.get(seq);
            if (event?.type !== 'tool/result')
                continue;
            const meta = event.data.meta;
            if (!meta || typeof meta !== 'object' || Array.isArray(meta))
                continue;
            const parsed = FeedbackMetaSchema.safeParse(meta.dafeiyuFeedback);
            if (!parsed.success)
                continue;
            const text = event.data.message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text === FEEDBACK_RETIRED_TEXT)
                continue;
            if (this.validate(this.item, parsed.data, text))
                continue;
            // DSH requires a tool-result rewrite to preserve every field except content,
            // including message identity, call ID, outcome and private presentation metadata.
            priceRetirement(this.scope, session, [seq]);
            session.append('tool/result', { ...event.data, message: { ...event.data.message, content: [{ type: 'text', text: FEEDBACK_RETIRED_TEXT }] } }, { surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq }, sourceEventSeqs: [seq] });
        }
    }
    guard(options) {
        if (!this.item || !this.agent)
            return;
        const messages = new Map(options.messages.filter(m => m.role === 'tool').map(m => [m.id, m]));
        const events = new Map(this.agent.session.snapshotEvents().map(e => [e.seq, e]));
        for (const seq of this.agent.session.surface.nodes) {
            const event = events.get(seq);
            if (event?.type !== 'tool/result')
                continue;
            const meta = event.data.meta;
            if (!meta || typeof meta !== 'object' || Array.isArray(meta))
                continue;
            const parsed = FeedbackMetaSchema.safeParse(meta.dafeiyuFeedback);
            if (!parsed.success)
                continue;
            const message = messages.get(event.data.message.id);
            if (!message)
                continue;
            const text = message.content.filter(b => b.type === 'text').map(b => b.text).join('\n');
            if (text === FEEDBACK_RETIRED_TEXT)
                continue;
            if (!this.validate(this.item, parsed.data, text))
                throw new Error('Tool feedback changed after admission');
        }
    }
}
