import { ChildProcess } from 'node:child_process';
import { z } from 'zod';
import type { ExecutorProcessControl } from './runner.js';
import type { ExecutorProcess } from './types.js';
/** Fixed package asset, never selected by model input or a per-job request. */
export declare const WINDOWS_PROCESS_PROBE_PATH: string;
export declare const WindowsProbeOptionsSchema: z.ZodObject<{
    powershellPath: z.ZodString;
    powershellHash: z.ZodString;
    nodePath: z.ZodString;
    nodeHash: z.ZodString;
    probeHash: z.ZodString;
    temporaryDirectory: z.ZodString;
    probeTimeoutMs: z.ZodOptional<z.ZodNumber>;
}, z.core.$strict>;
export type WindowsProbeOptions = z.infer<typeof WindowsProbeOptionsSchema>;
export declare const WindowsProcessControlOptionsSchema: z.ZodObject<{
    powershellPath: z.ZodString;
    powershellHash: z.ZodString;
    nodePath: z.ZodString;
    nodeHash: z.ZodString;
    probeHash: z.ZodString;
    temporaryDirectory: z.ZodString;
    probeTimeoutMs: z.ZodOptional<z.ZodNumber>;
    expectedOwnerSid: z.ZodString;
}, z.core.$strict>;
export type WindowsProcessControlOptions = z.infer<typeof WindowsProcessControlOptionsSchema>;
export declare const windowsProcessControlConfigurationHash: (raw: WindowsProcessControlOptions) => string;
/** ownerSid is native TokenUser; admin membership is an enabled, non-deny-only token group. */
export declare const WindowsNativeProcessProofSchema: z.ZodObject<{
    pid: z.ZodNumber;
    parentPid: z.ZodNumber;
    creationId: z.ZodString;
    creationTimeUtc: z.ZodISODateTime;
    executablePath: z.ZodString;
    ownerSid: z.ZodString;
    elevated: z.ZodBoolean;
    administratorsEnabled: z.ZodBoolean;
    elevationType: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>;
    restricted: z.ZodBoolean;
    alive: z.ZodBoolean;
}, z.core.$strict>;
export declare const WindowsHostProofSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    observedAt: z.ZodISODateTime;
    parent: z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        creationTimeUtc: z.ZodISODateTime;
        executablePath: z.ZodString;
        ownerSid: z.ZodString;
        elevated: z.ZodBoolean;
        administratorsEnabled: z.ZodBoolean;
        elevationType: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        restricted: z.ZodBoolean;
        alive: z.ZodBoolean;
        executableHash: z.ZodString;
    }, z.core.$strict>;
    powershellHash: z.ZodString;
    probeHash: z.ZodString;
    scope: z.ZodLiteral<"current-machine-only">;
}, z.core.$strict>;
export type WindowsHostProof = z.infer<typeof WindowsHostProofSchema>;
export declare const WindowsExecutionProofSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    observedAt: z.ZodISODateTime;
    parent: z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        creationTimeUtc: z.ZodISODateTime;
        executablePath: z.ZodString;
        ownerSid: z.ZodString;
        elevated: z.ZodBoolean;
        administratorsEnabled: z.ZodBoolean;
        elevationType: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        restricted: z.ZodBoolean;
        alive: z.ZodBoolean;
        executableHash: z.ZodString;
    }, z.core.$strict>;
    powershellHash: z.ZodString;
    probeHash: z.ZodString;
    scope: z.ZodLiteral<"current-machine-only">;
    child: z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        creationTimeUtc: z.ZodISODateTime;
        executablePath: z.ZodString;
        ownerSid: z.ZodString;
        elevated: z.ZodBoolean;
        administratorsEnabled: z.ZodBoolean;
        elevationType: z.ZodUnion<readonly [z.ZodLiteral<1>, z.ZodLiteral<2>, z.ZodLiteral<3>]>;
        restricted: z.ZodBoolean;
        alive: z.ZodBoolean;
        executableHash: z.ZodString;
    }, z.core.$strict>;
    descendants: z.ZodArray<z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        alive: z.ZodBoolean;
    }, z.core.$strict>>;
    snapshotComplete: z.ZodBoolean;
    treeContainment: z.ZodLiteral<"not-enforced">;
}, z.core.$strict>;
export type WindowsExecutionProof = z.infer<typeof WindowsExecutionProofSchema>;
export declare const WindowsTerminationEvidenceSchema: z.ZodObject<{
    schemaVersion: z.ZodLiteral<1>;
    observedAt: z.ZodISODateTime;
    process: z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        executableHash: z.ZodString;
    }, z.core.$strict>;
    rootIdentityRechecked: z.ZodBoolean;
    rootKillAccepted: z.ZodBoolean;
    rootExitObserved: z.ZodBoolean;
    descendantsBefore: z.ZodArray<z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        alive: z.ZodBoolean;
    }, z.core.$strict>>;
    descendantsAfter: z.ZodArray<z.ZodObject<{
        pid: z.ZodNumber;
        parentPid: z.ZodNumber;
        creationId: z.ZodString;
        alive: z.ZodBoolean;
    }, z.core.$strict>>;
    tracked: z.ZodArray<z.ZodObject<{
        pid: z.ZodNumber;
        creationId: z.ZodString;
        state: z.ZodEnum<{
            unknown: "unknown";
            alive: "alive";
            exited: "exited";
            "pid-reused": "pid-reused";
        }>;
    }, z.core.$strict>>;
    snapshotComplete: z.ZodBoolean;
    wholeTreeVerified: z.ZodLiteral<false>;
    gap: z.ZodString;
}, z.core.$strict>;
export type WindowsTerminationEvidence = z.infer<typeof WindowsTerminationEvidenceSchema>;
/** Observation only: no admin authorization is inferred from this result. Useful to attest the local deployment account. */
export declare function inspectWindowsHost(raw: WindowsProbeOptions): Promise<WindowsHostProof>;
/** Owns only the proof helper. close() must follow draining/terminating the caller's actual executor children. */
export declare class WindowsProcessControl implements ExecutorProcessControl {
    private readonly options;
    private readonly probe;
    private readonly initial;
    readonly configurationHash: string;
    private readonly proofs;
    private readonly terminations;
    private closed;
    private constructor();
    static create(raw: WindowsProcessControlOptions): Promise<WindowsProcessControl>;
    parentEvidence(): WindowsHostProof;
    private childId;
    private validateParent;
    prove(child: ChildProcess): Promise<WindowsExecutionProof>;
    identify(child: ChildProcess): Promise<ExecutorProcess>;
    terminationEvidence(child: ChildProcess): WindowsTerminationEvidence | null;
    terminate(child: ChildProcess, raw: ExecutorProcess): Promise<{
        verified: boolean;
    }>;
    close(): Promise<void>;
}
export declare const createWindowsProcessControl: (options: WindowsProcessControlOptions) => Promise<WindowsProcessControl>;
