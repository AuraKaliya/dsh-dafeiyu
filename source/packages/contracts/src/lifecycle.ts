import { z } from 'zod';

export const LifecycleModeSchema = z.enum(['legacy', 'managed']);
export type LifecycleMode = z.infer<typeof LifecycleModeSchema>;
export type ServicePhase = 'registered' | 'recovered' | 'active' | 'quiescing' | 'closed';

/** Runtime readiness is independent of constructing a service or opening its storage. */
export class ServiceGate {
  private phase: ServicePhase = 'registered';
  get state(): ServicePhase { return this.phase; }
  get active(): boolean { return this.phase === 'active'; }
  recovered(): void {
    if (this.phase === 'recovered' || this.phase === 'active') return;
    if (this.phase !== 'registered') throw new Error('SERVICE_LIFECYCLE_CONFLICT');
    this.phase = 'recovered';
  }
  activate(): void {
    if (this.phase === 'active') return;
    if (this.phase !== 'recovered') throw new Error('SERVICE_NOT_RECOVERED');
    this.phase = 'active';
  }
  quiesce(): void { if (this.phase !== 'closed') this.phase = 'quiescing'; }
  close(): void { this.phase = 'closed'; }
  assertActive(): void { if (!this.active) throw new Error('HOST_NOT_READY'); }
}

export interface LifecycleInspection { readonly ready: boolean; readonly codes: readonly string[] }
export interface LifecycleRecovery { readonly recovered: number; readonly interrupted: number }
export interface ServiceRegistry { has(feature: string): boolean }
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
export function dependencyOrder(components: readonly DependencyDescriptor[], available: readonly string[] = []): string[] {
  const names = new Set<string>(), provider = new Map<string, string>(), builtins = new Set(available);
  for (const component of components) {
    if (names.has(component.id)) throw new Error('DUPLICATE_COMPONENT');
    names.add(component.id);
    for (const feature of component.provides) {
      if (provider.has(feature) || builtins.has(feature)) throw new Error('DUPLICATE_FEATURE');
      provider.set(feature, component.id);
    }
  }
  const pending = new Map(components.map(component => [component.id, new Set(component.requires.map(feature => {
    const owner = provider.get(feature);
    if (!owner && !builtins.has(feature)) throw new Error('DEPENDENCY_UNAVAILABLE');
    return owner;
  }).filter((owner): owner is string => owner !== undefined && owner !== component.id))]));
  const result: string[] = [];
  while (pending.size) {
    const ready = [...pending].filter(([, requirements]) => requirements.size === 0).map(([id]) => id).sort();
    if (!ready.length) throw new Error('DEPENDENCY_CYCLE');
    for (const id of ready) { result.push(id); pending.delete(id); for (const requirements of pending.values()) requirements.delete(id); }
  }
  return result;
}
