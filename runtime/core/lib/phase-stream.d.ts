import type { StreamChunk } from '@deepseek-ai/dsh-llm';
/** A phase deadline also bounds a provider that has not yielded its next chunk. */
export declare function phaseStream(stream: AsyncIterable<StreamChunk>, signal: AbortSignal): AsyncIterable<StreamChunk>;
