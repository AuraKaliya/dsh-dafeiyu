import { z } from 'zod';
export declare const BILI_OWNER_AUTH_HASH = "84444bbabb740fa2ab0a63986c91660e0365391df0d0361940ce762dfadf967e";
export declare const BILI_OWNER_PRODUCTION_PROTOCOL = "bili-owner-production.v1";
export declare const BiliOwnerProductionConfigSchema: z.ZodObject<{
    installationRoot: z.ZodString;
    manifestPath: z.ZodString;
    manifestHash: z.ZodString;
    credentialFile: z.ZodOptional<z.ZodString>;
}, z.core.$strict>;
export type BiliOwnerProductionConfig = z.infer<typeof BiliOwnerProductionConfigSchema>;
export declare const BiliOwnerProductionManifestSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    kind: z.ZodLiteral<"bili-owner-channel">;
    enabled: z.ZodLiteral<true>;
    accountUid: z.ZodString;
    ownerUid: z.ZodString;
    generation: z.ZodNumber;
    authModuleHash: z.ZodLiteral<"84444bbabb740fa2ab0a63986c91660e0365391df0d0361940ce762dfadf967e">;
    publicConfigHash: z.ZodString;
}, z.core.$strict>;
export type BiliOwnerProductionManifest = z.infer<typeof BiliOwnerProductionManifestSchema>;
export interface PinnedBiliOwnerProductionBinding {
    readonly config: Readonly<BiliOwnerProductionConfig>;
    readonly manifest: Readonly<BiliOwnerProductionManifest>;
    readonly authSource: string;
    readonly identityHash: string;
    readonly bindingStamp: string;
    guard(): void;
    credentialPathGuard(): void;
}
export declare function assertPinnedBiliOwnerProductionBinding(value: PinnedBiliOwnerProductionBinding): void;
/** Reads only public deployment/source bytes. This does not open a credential file or perform platform IO. */
export declare function loadBiliOwnerProductionBinding(raw: unknown): PinnedBiliOwnerProductionBinding;
