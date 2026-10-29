import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {redactContent} from '@dafeiyu/contracts';
import type {Journal,NewEvent} from '@dafeiyu/journal';
import {CORE_VERSION} from './version.js';

export type FeedbackKind = 'must-know' | 'worth-sharing' | 'progress';
export type FeedbackState = 'pending' | 'sent' | 'expired' | 'superseded';

export interface FeedbackInput {
  readonly workItemId: string;
  readonly route: string;
  readonly kind: FeedbackKind;
  readonly text: string;
  /** For must-know: when silence becomes a broken promise. */
  readonly dueAt?: string;
  /** For worth-sharing/progress: after this the item is no longer worth saying. */
  readonly expiresAt?: string;
  readonly sourceEventId?: string;
}

export interface FeedbackRecord extends FeedbackInput {
  readonly id: string;
  readonly state: FeedbackState;
  readonly createdAt: string;
  readonly deliveryId?: string;
}

const inputSchema = z.strictObject({
  workItemId: z.string().min(1).max(300),
  route: z.string().min(1).max(2000),
  kind: z.enum(['must-know', 'worth-sharing', 'progress']),
  text: z.string().min(1).max(4000),
  dueAt: z.iso.datetime({offset: true}).optional(),
  expiresAt: z.iso.datetime({offset: true}).optional(),
  sourceEventId: z.uuid().optional(),
});
const queuedSchema = inputSchema.extend({id: z.uuid(), createdAt: z.iso.datetime({offset: true})});
const terminalSchema = z.strictObject({feedbackId: z.uuid(), deliveryId: z.string().min(1).max(300).optional()});

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/**
 * Durable feedback ledger over the existing Journal. It does not deliver anything:
 * it records what must be said, what is merely worth saying, and what was already said.
 * Delivery remains with NativeTaskDelivery / the conversation queue.
 */
export class FeedbackLedger {
  constructor(private readonly journal: Journal, private readonly agentId: string, private readonly now: () => number = Date.now) {}

  queue(raw: FeedbackInput): FeedbackRecord {
    const input = inputSchema.parse({...raw, text: redactContent(raw.text).value.slice(0, 4000)});
    if (!input.text) throw new Error('FEEDBACK_EMPTY');
    if (input.kind === 'must-know' && !input.dueAt) throw new Error('FEEDBACK_DUE_REQUIRED');
    const existing = this.pending(input.route).find(item =>
      item.workItemId === input.workItemId && item.kind === input.kind && hash(item.text) === hash(input.text));
    if (existing) return existing;
    const record: FeedbackRecord = {
      id: randomUUID(),
      state: 'pending',
      createdAt: new Date(this.now()).toISOString(),
      workItemId: input.workItemId,
      route: input.route,
      kind: input.kind,
      text: input.text,
      ...(input.dueAt ? {dueAt: input.dueAt} : {}),
      ...(input.expiresAt ? {expiresAt: input.expiresAt} : {}),
      ...(input.sourceEventId ? {sourceEventId: input.sourceEventId} : {}),
    };
    this.append(record.id, {
      route: record.route,
      traceId: record.id,
      operationId: record.id,
      type: 'feedback.queued',
      data: {
        id: record.id,
        workItemId: record.workItemId,
        route: record.route,
        kind: record.kind,
        text: record.text,
        createdAt: record.createdAt,
        ...(record.dueAt ? {dueAt: record.dueAt} : {}),
        ...(record.expiresAt ? {expiresAt: record.expiresAt} : {}),
        ...(record.sourceEventId ? {sourceEventId: record.sourceEventId} : {}),
      },
    });
    return record;
  }

  pending(route: string, at = this.now()): FeedbackRecord[] {
    const records = new Map<string, FeedbackRecord>();
    for (const event of this.journal.events(route)) {
      if (event.type === 'feedback.queued') {
        const parsed = queuedSchema.safeParse(event.data);
        if (!parsed.success) continue;
        const data = parsed.data;
        records.set(data.id, {
          id: data.id,
          workItemId: data.workItemId,
          route,
          kind: data.kind,
          text: data.text,
          state: 'pending',
          createdAt: data.createdAt,
          ...(data.dueAt ? {dueAt: data.dueAt} : {}),
          ...(data.expiresAt ? {expiresAt: data.expiresAt} : {}),
          ...(data.sourceEventId ? {sourceEventId: data.sourceEventId} : {}),
        });
        continue;
      }
      const parsed = terminalSchema.safeParse(event.data);
      if (!parsed.success) continue;
      const record = records.get(parsed.data.feedbackId);
      if (!record) continue;
      if (event.type === 'feedback.sent') records.set(record.id, {...record, state: 'sent', ...(parsed.data.deliveryId ? {deliveryId: parsed.data.deliveryId} : {})});
      else if (event.type === 'feedback.expired') records.set(record.id, {...record, state: 'expired'});
      else if (event.type === 'feedback.superseded') records.set(record.id, {...record, state: 'superseded'});
    }
    return [...records.values()]
      .filter(record => record.state === 'pending')
      .filter(record => !record.expiresAt || Date.parse(record.expiresAt) > at)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  due(route: string, at = this.now()): FeedbackRecord[] {
    return this.pending(route, at).filter(record => record.kind === 'must-know' && record.dueAt !== undefined && Date.parse(record.dueAt) <= at);
  }

  worthSharing(route: string, at = this.now()): FeedbackRecord[] {
    return this.pending(route, at).filter(record => record.kind === 'worth-sharing');
  }

  markSent(id: string, deliveryId: string, route: string): void {
    this.terminal(id, route, 'feedback.sent', {feedbackId: id, deliveryId});
  }

  expire(id: string, route: string): void {
    this.terminal(id, route, 'feedback.expired', {feedbackId: id});
  }

  supersede(id: string, route: string): void {
    this.terminal(id, route, 'feedback.superseded', {feedbackId: id});
  }

  private terminal(id: string, route: string, type: string, data: Record<string, string>): void {
    z.uuid().parse(id);
    this.append(randomUUID(), {route, traceId: id, operationId: id, type, data});
  }

  private append(id: string, input: {route: string; traceId: string; operationId: string; type: string; data: Record<string, unknown>}): void {
    const event: NewEvent = {
      agentId: this.agentId,
      route: input.route,
      traceId: input.traceId,
      operationId: input.operationId,
      causedBy: null,
      type: input.type,
      plugin: '@dafeiyu/core',
      pluginVersion: CORE_VERSION,
      occurredAt: new Date(this.now()).toISOString(),
      sources: [],
      data: z.record(z.string(), z.json()).parse(input.data),
    };
    this.journal.appendOnce(event, id);
  }
}
