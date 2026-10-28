import type { NativeExpressionPacket } from '#dafeiyu/contracts';
type Evidence = NativeExpressionPacket['evidence'][number];
/** Lossless packaging after target/source admission. It never selects or authorizes content. */
export declare function packNativeEvidence(items: Evidence[]): Evidence[];
export {};
