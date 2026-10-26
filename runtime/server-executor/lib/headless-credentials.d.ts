import { z } from 'zod';
export declare const HeadlessCredentialBindingSchema: z.ZodObject<{
    credentialStore: z.ZodObject<{
        path: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>;
    credentialName: z.ZodLiteral<"DEEPSEEK_API_KEY">;
    baseURL: z.ZodURL;
}, z.core.$strict>;
export type HeadlessCredentialBinding = z.infer<typeof HeadlessCredentialBindingSchema>;
export interface HeadlessCredentialMetadata {
    schemaVersion: 1;
    credentialName: 'DEEPSEEK_API_KEY';
    source: 'file';
    configured: true;
    storeHash: string;
}
/** Runtime-only fingerprint and format check. Never returns, logs, copies, or resolves the credential value. */
export declare function inspectPinnedModelCredential(raw: HeadlessCredentialBinding): HeadlessCredentialMetadata;
/** Describe is the official metadata-only API; the native adapter alone resolves the selected key for an actual request. */
export declare function assertPinnedCredentialDescription(service: unknown, binding: HeadlessCredentialBinding): Promise<void>;
