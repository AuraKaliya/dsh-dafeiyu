import type { DeliveryResult, Reply } from '#dafeiyu/contracts';
import type { QqDeliveryLedger } from './delivery.js';
interface TransportHost {
    ledger: QqDeliveryLedger;
    beforeSend?(reply: Reply, signal: AbortSignal): Promise<void>;
    check(reply: Reply, signal: AbortSignal): Promise<void>;
    send(reply: Reply, text: string, signal: AbortSignal): Promise<string>;
    confirmed(reply: Reply, text: string, receipt: string): void;
}
/** One sender per reply; a durable unknown is never interpreted as permission to resend. */
export declare class QqSegmentedTransport {
    private readonly host;
    private readonly active;
    constructor(host: TransportHost);
    deliver(reply: Reply, signal: AbortSignal, authority?: () => void): Promise<DeliveryResult>;
    private execute;
}
export {};
