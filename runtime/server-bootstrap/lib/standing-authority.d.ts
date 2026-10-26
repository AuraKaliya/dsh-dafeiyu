import { z } from 'zod';
import type { ExternalTaskAuthority } from '#dafeiyu/contracts';
export declare const StandingAuthoritySchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodString;
    version: z.ZodNumber;
    agentId: z.ZodString;
    producers: z.ZodArray<z.ZodString>;
    policyIds: z.ZodArray<z.ZodString>;
    actionIds: z.ZodArray<z.ZodString>;
    purpose: z.ZodString;
    effectiveAt: z.ZodISODateTime;
    expiresAt: z.ZodNullable<z.ZodISODateTime>;
    revoked: z.ZodBoolean;
    allowedWorkRoots: z.ZodArray<z.ZodString>;
    budgetAuthorizationId: z.ZodString;
    maxExecutionMs: z.ZodNumber;
}, z.core.$strict>;
export type StandingAuthority = z.infer<typeof StandingAuthoritySchema>;
export declare const StandingAuthorityFileSchema: z.ZodObject<{
    path: z.ZodString;
    configurationRoot: z.ZodString;
    id: z.ZodString;
    version: z.ZodNumber;
    hash: z.ZodString;
}, z.core.$strict>;
export interface StandingTaskPermission {
    readonly id: string;
    readonly version: number;
    readonly hash: string;
    readonly budgetAuthorizationId: string;
    readonly allowedWorkRoots: readonly string[];
    readonly maxExecutionMs: number;
    readonly workingDirectory: string;
    /** Revalidates the live Core grant and pinned operator file; does not mint a Core grant. */
    guard(): void;
}
/** Operator-owned, version/hash-pinned configuration, separate from model-managed activity plans. */
export declare class StandingAuthorityFile {
    private readonly clock;
    private readonly config;
    constructor(raw: unknown, clock?: () => number);
    private read;
    authorize(authority: ExternalTaskAuthority, workingDirectory: string): StandingTaskPermission;
}
