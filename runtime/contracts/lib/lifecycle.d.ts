import { z } from 'zod';
export declare const LifecycleModeSchema: z.ZodEnum<{
    legacy: "legacy";
    managed: "managed";
}>;
export type LifecycleMode = z.infer<typeof LifecycleModeSchema>;
export type ServicePhase = 'registered' | 'recovered' | 'active' | 'quiescing' | 'closed';
/** Runtime readiness is independent of constructing a service or opening its storage. */
export declare class ServiceGate {
    private phase;
    get state(): ServicePhase;
    get active(): boolean;
    recovered(): void;
    activate(): void;
    quiesce(): void;
    close(): void;
    assertActive(): void;
}
export interface LifecycleInspection {
    readonly ready: boolean;
    readonly codes: readonly string[];
}
export interface LifecycleRecovery {
    readonly recovered: number;
    readonly interrupted: number;
}
export interface ServiceRegistry {
    has(feature: string): boolean;
}
export interface ManagedLifecycle {
    inspect(): Promise<LifecycleInspection>;
    open(): Promise<void>;
    bind(registry: ServiceRegistry): void;
    recover(): Promise<LifecycleRecovery>;
    activate(): Promise<void>;
    quiesce(reason: string): Promise<void>;
    drain(signal: AbortSignal): Promise<void>;
    dispose(): Promise<void>;
}
export interface DependencyDescriptor {
    readonly id: string;
    readonly provides: readonly string[];
    readonly requires: readonly string[];
}
/** Deterministic activation order; bind-time seams must not be declared as activation cycles. */
export declare function dependencyOrder(components: readonly DependencyDescriptor[], available?: readonly string[]): string[];
