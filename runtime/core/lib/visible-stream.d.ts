import type { StreamChunk } from '@deepseek-ai/dsh-llm';
/** Only public content reaches DSH JSONL; transport reasoning and replay stay out. */
export declare function visibleStream(input: AsyncIterable<StreamChunk>): AsyncIterable<StreamChunk>;
