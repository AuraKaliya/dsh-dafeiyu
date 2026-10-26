import type { Json } from './index.js';
export interface Redacted<T> {
    value: T;
    redacted: boolean;
}
/** Conservative known-secret masking, not an authorization decision or a universal secret detector. */
export declare function redactText(text: string): Redacted<string>;
export declare function redactJson(input: Json): Redacted<Json>;
/** Parse complete JSON before redaction, so a credential cannot leak across text page boundaries. */
export declare function redactContent(text: string): Redacted<string>;
