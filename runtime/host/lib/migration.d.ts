import { z } from 'zod';
import type { RuntimeIdentity } from '#dafeiyu/core/runtime-store';
import type { ExecutorFileSnapshot } from './executor-snapshot.js';
import type { MediaFileSnapshot } from './media-snapshot.js';
import type { StorageKind, StorageInspection } from './storage-inspection.js';
export interface MigrationBundle {
    coreDir: string;
    memoryDir: string;
    sessionsDir: string;
    backupDir: string;
    identity: RuntimeIdentity;
    qqFiles?: readonly string[] | undefined;
    activity?: boolean | undefined;
    media?: boolean | undefined;
    bilibili?: boolean | undefined;
    executor?: boolean | undefined;
    biliOwner?: boolean | undefined;
    biliOwnerIdentity?: {
        accountUid: string;
        ownerUid: string;
    } | undefined;
    provenance?: {
        sourceRevision: string;
        dirty: boolean;
        configHash: string;
    } | undefined;
}
interface RowsSnapshot {
    table: string;
    hash: string;
    rows: number;
}
interface FilePlan {
    kind: StorageKind;
    file: string;
    before: StorageInspection;
    rows: RowsSnapshot[];
    targetVersion: number;
}
export interface MigrationPlan {
    schemaVersion: 1;
    id: string;
    createdAt: string;
    engineHash: string;
    bundle: MigrationBundle;
    files: FilePlan[];
    sessions: {
        relative: string;
        hash: string;
    }[];
    mediaFiles?: MediaFileSnapshot[] | undefined;
    executorFiles?: ExecutorFileSnapshot[] | undefined;
}
export declare const MigrationPlanSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    id: z.ZodUUID;
    createdAt: z.ZodISODateTime;
    engineHash: z.ZodString;
    bundle: z.ZodObject<{
        coreDir: z.ZodString;
        memoryDir: z.ZodString;
        sessionsDir: z.ZodString;
        backupDir: z.ZodString;
        identity: z.ZodObject<{
            agentId: z.ZodString;
            profileId: z.ZodString;
        }, z.core.$strict>;
        qqFiles: z.ZodOptional<z.ZodArray<z.ZodString>>;
        activity: z.ZodOptional<z.ZodBoolean>;
        media: z.ZodOptional<z.ZodBoolean>;
        bilibili: z.ZodOptional<z.ZodBoolean>;
        executor: z.ZodOptional<z.ZodBoolean>;
        biliOwner: z.ZodOptional<z.ZodBoolean>;
        biliOwnerIdentity: z.ZodOptional<z.ZodObject<{
            accountUid: z.ZodString;
            ownerUid: z.ZodString;
        }, z.core.$strict>>;
        provenance: z.ZodOptional<z.ZodObject<{
            sourceRevision: z.ZodString;
            dirty: z.ZodBoolean;
            configHash: z.ZodString;
        }, z.core.$strict>>;
    }, z.core.$strict>;
    files: z.ZodArray<z.ZodObject<{
        kind: z.ZodEnum<{
            runtime: "runtime";
            feedback: "feedback";
            memory: "memory";
            qq: "qq";
            bilibili: "bilibili";
            activity: "activity";
            media: "media";
            analysis: "analysis";
            retrieval: "retrieval";
            journal: "journal";
            delivery: "delivery";
            working: "working";
            executor: "executor";
            "bili-owner": "bili-owner";
        }>;
        file: z.ZodString;
        before: z.ZodObject<{
            kind: z.ZodEnum<{
                runtime: "runtime";
                feedback: "feedback";
                memory: "memory";
                qq: "qq";
                bilibili: "bilibili";
                activity: "activity";
                media: "media";
                analysis: "analysis";
                retrieval: "retrieval";
                journal: "journal";
                delivery: "delivery";
                working: "working";
                executor: "executor";
                "bili-owner": "bili-owner";
            }>;
            exists: z.ZodBoolean;
            version: z.ZodNumber;
            applicationId: z.ZodNumber;
            supported: z.ZodBoolean;
            activeOwner: z.ZodBoolean;
            integrity: z.ZodBoolean;
            identityMatches: z.ZodBoolean;
        }, z.core.$strict>;
        rows: z.ZodArray<z.ZodObject<{
            table: z.ZodString;
            hash: z.ZodString;
            rows: z.ZodNumber;
        }, z.core.$strict>>;
        targetVersion: z.ZodNumber;
    }, z.core.$strict>>;
    sessions: z.ZodArray<z.ZodObject<{
        relative: z.ZodString;
        hash: z.ZodString;
    }, z.core.$strict>>;
    mediaFiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
        relative: z.ZodString;
        bytes: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>>>;
    executorFiles: z.ZodOptional<z.ZodArray<z.ZodObject<{
        relative: z.ZodString;
        bytes: z.ZodNumber;
        hash: z.ZodString;
    }, z.core.$strict>>>;
}, z.core.$strict>;
/** Plan captures metadata and row digests only; it neither constructs services nor changes source schemas. */
export declare function planMigration(input: MigrationBundle): Promise<MigrationPlan>;
/** Applies only closed fictional/explicitly selected local bundles. No automatic rollback overwrites newer data. */
export declare function applyMigration(rawPlan: MigrationPlan, options?: {
    afterStep?: (kind: StorageKind) => void;
}): Promise<{
    manifest: string;
    complete: boolean;
}>;
export declare function verifyMigration(plan: MigrationPlan): {
    passed: boolean;
    stores: StorageInspection[];
    executorEvidencePreserved?: boolean;
    biliOwnerEvidencePreserved?: boolean;
};
export {};
