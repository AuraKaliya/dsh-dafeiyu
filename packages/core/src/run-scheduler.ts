/**
 * Admission scheduler for interactive conversations, owner tasks, background work and autonomy.
 *
 * This is the v1 "RunLease" layer from the attention design:
 * - interactive work keeps a reserved slot when background work is waiting;
 * - background work can never take the last reserved slot;
 * - after `antiStarvation` consecutive interactive grants, an eligible background item gets the next slot;
 * - owner tasks are background work with a small ordering bonus, never "interactive foreground";
 * - focus is a soft affinity for interactive work, not a resource lock.
 *
 * No call-count cap and no model logic lives here. The scheduler only decides admission.
 */
export type RunClass = 'interactive' | 'owner-task' | 'background' | 'autonomy';

export interface RunLease {
  /** Stable work item: task id for task work, inbound id for conversation work. */
  readonly workItemId: string;
  /** Conversation route or task scope key. Used for focus affinity and diagnostics. */
  readonly route: string;
  readonly class: RunClass;
  /** ISO deadline; recorded for diagnostics, not enforced by the scheduler. */
  readonly deadline?: string;
  /** Caller-owned upper bound for a single run. Recorded; callers enforce it. */
  readonly maxDurationMs?: number;
  /** Whether the owner of the work can yield when a higher-priority item arrives. */
  readonly preemptible?: boolean;
}

/** Soft focus lease: which conversation currently owns interactive affinity. Never a resource lock. */
export interface FocusLease {
  readonly route: string;
  readonly expiresAt: string;
  readonly affinityUntil: string | null;
  readonly switchCooldownUntil: string;
}

export interface AttentionDecision {
  readonly at: string;
  readonly chosen: string;
  readonly chosenClass: RunClass;
  readonly route: string;
  readonly reason: 'interactive' | 'background' | 'anti-starvation' | 'owner-task' | 'focus';
  readonly waitedMs: number;
  readonly active: number;
  readonly interactiveActive: number;
  readonly backgroundActive: number;
  readonly waiting: number;
  readonly interactiveWaiting: number;
  readonly backgroundWaiting: number;
  readonly interactiveStreak: number;
}

export interface SchedulerOptions {
  /** Slots kept usable by background work while interactive work is waiting. */
  readonly interactiveReserve?: number;
  /** Consecutive interactive grants after which an eligible background item must run. */
  readonly antiStarvation?: number;
  /** How long a focus route remains current without inbound activity. */
  readonly focusTtlMs?: number;
  /** How long after inbound activity the focused route keeps ordering affinity. */
  readonly affinityMs?: number;
  /** Minimum time between focus route changes. */
  readonly switchCooldownMs?: number;
  readonly now?: () => number;
  /** Called on every grant. Must not throw; the scheduler isolates callbacks. */
  readonly onDecision?: (decision: AttentionDecision) => void;
}

interface Waiter {
  readonly lease: RunLease;
  readonly enqueuedAt: number;
  readonly resolve: (release: () => void) => void;
  startedAt?: number;
}

const INTERACTIVE: RunClass = 'interactive';
const CLASS_ORDER: Record<RunClass, number> = { 'interactive': 0, 'owner-task': 1, 'background': 2, 'autonomy': 3 };

export class RunScheduler {
  private used = 0;
  private interactiveActive = 0;
  private backgroundActive = 0;
  private interactiveStreak = 0;
  private readonly queue: Waiter[] = [];
  private readonly served = new Map<string, number>();
  private legacyCounter = 0;
  private focusRoute: string | undefined;
  private focusUntil = 0;
  private affinityUntil = 0;
  private switchCooldownUntil = 0;
  private readonly interactiveReserve: number;
  private readonly antiStarvation: number;
  private readonly focusTtlMs: number;
  private readonly affinityMs: number;
  private readonly switchCooldownMs: number;
  private readonly now: () => number;
  private readonly onDecision: ((decision: AttentionDecision) => void) | undefined;

  constructor(private readonly limit: number, options: SchedulerOptions = {}) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('INVALID_RUN_LIMIT');
    this.interactiveReserve = Math.max(0, Math.min(limit - 1, options.interactiveReserve ?? (limit > 1 ? 1 : 0)));
    this.antiStarvation = Math.max(1, options.antiStarvation ?? 3);
    this.focusTtlMs = Math.max(1, options.focusTtlMs ?? 5 * 60_000);
    this.affinityMs = Math.max(0, options.affinityMs ?? 2 * 60_000);
    this.switchCooldownMs = Math.max(0, options.switchCooldownMs ?? 10_000);
    this.now = options.now ?? Date.now;
    this.onDecision = options.onDecision;
  }

  /** Records an inbound user message as focus activity. Background work must not call this. */
  noteInbound(route: string): void {
    if (!route) return;
    const at = this.now();
    if (!this.focusRoute || at >= this.focusUntil) {
      this.focusRoute = route;
      this.focusUntil = at + this.focusTtlMs;
    } else if (route === this.focusRoute) {
      this.focusUntil = Math.max(this.focusUntil, at + this.focusTtlMs);
    } else if (at >= this.switchCooldownUntil) {
      this.focusRoute = route;
      this.focusUntil = at + this.focusTtlMs;
      this.switchCooldownUntil = at + this.switchCooldownMs;
    }
    if (route === this.focusRoute) this.affinityUntil = at + this.affinityMs;
  }

  /**
   * Acquires one admission slot. The boolean form is kept for callers that only know
   * "foreground vs background"; new callers pass a RunLease.
   */
  acquire(lease: RunLease | boolean, route = ''): Promise<() => void> {
    const normalized = typeof lease === 'boolean'
      ? { workItemId: `legacy-${++this.legacyCounter}`, route, class: lease ? INTERACTIVE : 'background' } satisfies RunLease
      : lease;
    return new Promise(resolve => {
      this.queue.push({ lease: normalized, enqueuedAt: this.now(), resolve });
      this.pump();
    });
  }

  get status() {
    const interactiveWaiting = this.queue.filter(item => item.lease.class === INTERACTIVE).length;
    return {
      active: this.used,
      waiting: this.queue.length,
      /** Kept for existing activity-pressure readers. */
      foregroundWaiting: interactiveWaiting,
      interactiveActive: this.interactiveActive,
      backgroundActive: this.backgroundActive,
      interactiveWaiting,
      backgroundWaiting: this.queue.length - interactiveWaiting,
      interactiveStreak: this.interactiveStreak,
      focusRoute: this.focusRoute ?? null,
      interactiveReserve: this.interactiveReserve,
      antiStarvation: this.antiStarvation,
    };
  }

  get focus() {
    const at = this.now();
    return {
      route: this.focusRoute && at < this.focusUntil ? this.focusRoute : null,
      affinity: this.focusRoute && at < this.affinityUntil ? this.focusRoute : null,
    };
  }

  /** Serializable snapshot for diagnostics/tests; null when the focus lease expired. */
  get focusLease(): FocusLease | null {
    const at = this.now();
    if (!this.focusRoute || at >= this.focusUntil) return null;
    return {
      route: this.focusRoute,
      expiresAt: new Date(this.focusUntil).toISOString(),
      affinityUntil: at < this.affinityUntil ? new Date(this.affinityUntil).toISOString() : null,
      switchCooldownUntil: new Date(this.switchCooldownUntil).toISOString(),
    };
  }

  private get maxBackground(): number {
    return Math.max(1, this.limit - this.interactiveReserve);
  }

  private hasWaitingBackground(): boolean {
    return this.queue.some(item => item.lease.class !== INTERACTIVE);
  }

  private canGrantInteractive(): boolean {
    if (this.used >= this.limit) return false;
    if (!this.hasWaitingBackground()) return true;
    // Background already occupies all of its slots: the remaining slot may be used interactively.
    if (this.backgroundActive >= this.maxBackground) return true;
    // Otherwise keep the configured number of slots free for waiting background work.
    return this.used + 1 <= this.limit - this.interactiveReserve;
  }

  private canGrantBackground(): boolean {
    return this.used < this.limit && this.backgroundActive < this.maxBackground;
  }

  private pickBackground(): Waiter | undefined {
    const eligible = this.queue.filter(item => item.lease.class !== INTERACTIVE);
    if (!eligible.length) return undefined;
    const at = this.now();
    eligible.sort((left, right) => {
      // Higher score wins. Owner tasks have weight 2; already-served time is subtracted so
      // a long-running owner task does not keep beating fresh work forever.
      const leftScore = (at - left.enqueuedAt) * this.classWeight(left.lease.class) - (this.served.get(left.lease.workItemId) ?? 0);
      const rightScore = (at - right.enqueuedAt) * this.classWeight(right.lease.class) - (this.served.get(right.lease.workItemId) ?? 0);
      if (leftScore !== rightScore) return rightScore - leftScore;
      return CLASS_ORDER[left.lease.class] - CLASS_ORDER[right.lease.class];
    });
    return eligible[0];
  }

  private classWeight(cls: RunClass): number {
    return cls === 'owner-task' ? 2 : 1;
  }

  /** Forget a completed work item's service history. */
  forget(workItemId: string): void {
    this.served.delete(workItemId);
  }

  /** Total admitted service time for diagnostics/tests. */
  servedMs(workItemId: string): number {
    return this.served.get(workItemId) ?? 0;
  }

  private rememberServed(workItemId: string, elapsedMs: number): void {
    if (!this.served.has(workItemId) && this.served.size >= 1024) {
      const oldest = this.served.keys().next().value;
      if (oldest !== undefined) this.served.delete(oldest);
    }
    this.served.set(workItemId, (this.served.get(workItemId) ?? 0) + Math.max(0, elapsedMs));
  }

  private pickInteractive(): Waiter | undefined {
    const eligible = this.queue.filter(item => item.lease.class === INTERACTIVE);
    if (!eligible.length) return undefined;
    const focused = this.focus.affinity;
    eligible.sort((left, right) => {
      const leftFocus = focused !== null && left.lease.route === focused ? 0 : 1;
      const rightFocus = focused !== null && right.lease.route === focused ? 0 : 1;
      if (leftFocus !== rightFocus) return leftFocus - rightFocus;
      return left.enqueuedAt - right.enqueuedAt;
    });
    return eligible[0];
  }

  private pump(): void {
    while (this.queue.length) {
      const streakBefore = this.interactiveStreak;
      const backgroundWaiting = this.hasWaitingBackground();
      const background = this.pickBackground();
      const interactive = this.pickInteractive();
      const antiStarving = backgroundWaiting && streakBefore >= this.antiStarvation && !!background && this.canGrantBackground();
      let chosen: Waiter | undefined;
      let reason: AttentionDecision['reason'] = 'interactive';

      if (antiStarving) {
        chosen = background;
        reason = 'anti-starvation';
      } else if (interactive && this.canGrantInteractive()) {
        const focusAffinity = this.focus.affinity;
        chosen = interactive;
        reason = focusAffinity !== null && interactive.lease.route === focusAffinity ? 'focus' : 'interactive';
      } else if (background && this.canGrantBackground()) {
        chosen = background;
        reason = background.lease.class === 'owner-task' ? 'owner-task' : 'background';
      }

      if (!chosen) return;
      const index = this.queue.indexOf(chosen);
      if (index < 0) return;
      this.queue.splice(index, 1);
      this.used++;
      if (chosen.lease.class === INTERACTIVE) {
        this.interactiveActive++;
        this.interactiveStreak++;
      } else {
        this.backgroundActive++;
        this.interactiveStreak = 0;
      }

      const decision: AttentionDecision = {
        at: new Date(this.now()).toISOString(),
        chosen: chosen.lease.workItemId,
        chosenClass: chosen.lease.class,
        route: chosen.lease.route,
        reason,
        waitedMs: Math.max(0, this.now() - chosen.enqueuedAt),
        active: this.used,
        interactiveActive: this.interactiveActive,
        backgroundActive: this.backgroundActive,
        waiting: this.queue.length,
        interactiveWaiting: this.queue.filter(item => item.lease.class === INTERACTIVE).length,
        backgroundWaiting: this.queue.filter(item => item.lease.class !== INTERACTIVE).length,
        interactiveStreak: this.interactiveStreak,
      };
      this.emit(decision);

      const cls = chosen.lease.class;
      chosen.startedAt = this.now();
      let released = false;
      chosen.resolve(() => {
        if (released) return;
        released = true;
        if (chosen.startedAt !== undefined) this.rememberServed(chosen.lease.workItemId, this.now() - chosen.startedAt);
        this.used--;
        if (cls === INTERACTIVE) this.interactiveActive--;
        else this.backgroundActive--;
        this.pump();
      });
    }
  }

  private emit(decision: AttentionDecision): void {
    if (!this.onDecision) return;
    try {
      this.onDecision(decision);
    } catch {
      // Observability must never break admission.
    }
  }
}
