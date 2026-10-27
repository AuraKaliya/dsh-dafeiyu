import type { Reply, ReplyMediaManifest, DeliveryResult } from '#dafeiyu/contracts';
import type { QqMediaDeliveryLedger, QqMediaDeliveryPlan } from './media-delivery.js';
type MediaReply = Reply & {
    media: ReplyMediaManifest;
};
type Part = QqMediaDeliveryPlan['parts'][number];
interface Host {
    ledger: QqMediaDeliveryLedger;
    legacyProgress(id: string): {
        confirmed: number;
        unknown: number;
        state: string;
    } | null;
    beforeSend?(reply: Reply, signal: AbortSignal): Promise<void>;
    check(reply: Reply, signal: AbortSignal): Promise<void>;
    send(reply: MediaReply, part: Part, data: Uint8Array | null, signal: AbortSignal): Promise<string>;
    confirmed(reply: MediaReply, part: Part, receipt: string): void;
}
/** No generation, file paths or re-rendering. Each approved part has one durable external-effect transition. */
export declare class QqMediaTransport {
    private readonly host;
    private readonly active;
    constructor(host: Host);
    deliver(reply: MediaReply, signal: AbortSignal, authority: () => void, bytes: (position: number) => Promise<Uint8Array>): Promise<DeliveryResult>;
    private execute;
}
export {};
