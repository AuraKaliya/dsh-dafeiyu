export interface HttpResponse {
    status: number;
    headers: Readonly<Record<string, string | undefined>>;
    body: AsyncIterable<Uint8Array>;
    close(): void;
}
export type HttpTransport = (url: URL, headers: Readonly<Record<string, string>>, signal: AbortSignal) => Promise<HttpResponse>;
export declare function publicAddress(value: string): boolean;
export declare function biliUrl(value: string, kind: 'api' | 'media' | 'subtitle'): URL;
/** Pinned public IPv4, fixed HTTPS origin, no automatic redirect or ambient credentials. */
export declare const nativeTransport: HttpTransport;
export declare function boundedBytes(response: HttpResponse, maximum: number, signal: AbortSignal, guard: () => void): Promise<Buffer<ArrayBuffer>>;
export declare function boundedJson(bytes: Uint8Array): unknown;
