/** Program-issued work identity carried from a Run into model-call admission. */
export type WorkClass = 'interactive' | 'owner-task' | 'background' | 'autonomy';

export interface WorkCallContext {
  readonly workItemId: string;
  readonly runId: string;
  /** Conversation route or task scope key. */
  readonly scopeKey: string;
  readonly class: WorkClass;
  /** Task goal/intent version; 0 for plain conversation. */
  readonly targetVersion: number;
  /** Program stage, e.g. conversation/exploration/review/delivery. */
  readonly stage: string;
}

export interface UnboundWorkCall {
  readonly at: string;
  readonly sessionId?: string;
  readonly purpose?: string;
}

/**
 * Process-local bindings from stable session/job identities to program-issued work.
 * Model output, extension payloads and executor children are lookup keys only; they
 * never provide the class or work item identity.
 */
export class WorkContextRegistry {
  private readonly sessions = new Map<string, WorkCallContext>();
  private readonly jobs = new Map<string, WorkCallContext>();
  private readonly unbound: UnboundWorkCall[] = [];

  bindSession(sessionId: string, context: WorkCallContext): () => void {
    const frozen = Object.freeze({ ...context });
    this.sessions.set(sessionId, frozen);
    return () => {
      if (this.sessions.get(sessionId) === frozen) this.sessions.delete(sessionId);
    };
  }

  resolveSession(sessionId: string | undefined): WorkCallContext | undefined {
    return sessionId ? this.sessions.get(sessionId) : undefined;
  }

  bindJob(jobId: string, context: WorkCallContext): () => void {
    const frozen = Object.freeze({ ...context });
    this.jobs.set(jobId, frozen);
    return () => {
      if (this.jobs.get(jobId) === frozen) this.jobs.delete(jobId);
    };
  }

  resolveJob(jobId: string | undefined): WorkCallContext | undefined {
    return jobId ? this.jobs.get(jobId) : undefined;
  }

  noteUnbound(detail: Omit<UnboundWorkCall, 'at'>): void {
    this.unbound.push(Object.freeze({ at: new Date().toISOString(), ...detail }));
    while (this.unbound.length > 64) this.unbound.shift();
  }

  diagnostics() {
    return {
      boundSessions: this.sessions.size,
      boundJobs: this.jobs.size,
      unbound: this.unbound.slice(),
    };
  }

  clear(): void {
    this.sessions.clear();
    this.jobs.clear();
    this.unbound.length = 0;
  }
}

/** One registry per process; session/job ids are UUIDs, so instances do not collide. */
export const workContexts = new WorkContextRegistry();
