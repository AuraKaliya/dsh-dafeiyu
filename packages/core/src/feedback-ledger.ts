import {createHash,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {redactContent} from '@dafeiyu/contracts';
import type {Journal,NewEvent} from '@dafeiyu/journal';
import {CORE_VERSION} from './version.js';

export type FeedbackKind = 'must-know' | 'worth-sharing' | 'progress';
export type FeedbackState = 'pending' | 'sending' | 'sent' | 'unknown' | 'expired' | 'superseded';

export interface FeedbackInput {
  readonly workItemId: string;
  readonly route: string;
  readonly kind: FeedbackKind;
  readonly text: string;
  /** Original inbound message; latest message is never a substitute for this. */
  readonly sourceMessageId?: string;
  readonly taskId?: string;
  readonly runId?: string;
  readonly intentVersion?: number;
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
  readonly attempts: number;
  readonly deliveryId?: string;
}

const inputSchema = z.strictObject({
  workItemId: z.string().min(1).max(300),
  route: z.string().min(1).max(2000),
  kind: z.enum(['must-know', 'worth-sharing', 'progress']),
  text: z.string().min(1).max(4000),
  sourceMessageId: z.string().min(1).max(300).optional(),
  taskId: z.uuid().optional(),
  runId: z.uuid().optional(),
  intentVersion: z.number().int().nonnegative().optional(),
  dueAt: z.iso.datetime({offset: true}).optional(),
  expiresAt: z.iso.datetime({offset: true}).optional(),
  sourceEventId: z.uuid().optional(),
});
const queuedSchema = inputSchema.extend({id: z.uuid(), createdAt: z.iso.datetime({offset: true})});
const terminalSchema = z.strictObject({feedbackId: z.uuid(), deliveryId: z.string().min(1).max(300).optional(), receiptId: z.string().min(1).max(300).optional()});
const sendingSchema = z.strictObject({feedbackId: z.uuid(), deliveryId: z.string().min(1).max(300), attempt: z.number().int().positive()});
const releasedSchema = z.strictObject({feedbackId: z.uuid(), reason: z.string().min(1).max(120), attempt: z.number().int().positive()});
const unknownSchema = z.strictObject({feedbackId: z.uuid(), deliveryId: z.string().min(1).max(300), code: z.string().min(1).max(120)});
const sourceSchema = z.strictObject({feedbackId: z.uuid(), sourceMessageId: z.string().min(1).max(300), taskId: z.uuid().optional(), runId: z.uuid().optional(), intentVersion: z.number().int().nonnegative().optional()});

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
    const existing = this.pending(input.route, this.now(), true).find(item => (item.state === 'pending' || item.state === 'sending') &&
      item.workItemId === input.workItemId && item.kind === input.kind && hash(item.text) === hash(input.text));
    if (existing) return existing;
    const record: FeedbackRecord = {
      id: randomUUID(),
      state: 'pending',
      createdAt: new Date(this.now()).toISOString(),
      attempts: 0,
      workItemId: input.workItemId,
      route: input.route,
      kind: input.kind,
      text: input.text,
      ...(input.sourceMessageId ? {sourceMessageId: input.sourceMessageId} : {}),
      ...(input.taskId ? {taskId: input.taskId} : {}),
      ...(input.runId ? {runId: input.runId} : {}),
      ...(input.intentVersion !== undefined ? {intentVersion: input.intentVersion} : {}),
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
        ...(record.sourceMessageId ? {sourceMessageId: record.sourceMessageId} : {}),
        ...(record.taskId ? {taskId: record.taskId} : {}),
        ...(record.runId ? {runId: record.runId} : {}),
        ...(record.intentVersion !== undefined ? {intentVersion: record.intentVersion} : {}),
        ...(record.dueAt ? {dueAt: record.dueAt} : {}),
        ...(record.expiresAt ? {expiresAt: record.expiresAt} : {}),
        ...(record.sourceEventId ? {sourceEventId: record.sourceEventId} : {}),
      },
    });
    return record;
  }

  pending(route: string, at = this.now(), includeNonPending = false): FeedbackRecord[] {
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
          attempts: 0,
          ...(data.sourceMessageId ? {sourceMessageId: data.sourceMessageId} : {}),
          ...(data.taskId ? {taskId: data.taskId} : {}),
          ...(data.runId ? {runId: data.runId} : {}),
          ...(data.intentVersion !== undefined ? {intentVersion: data.intentVersion} : {}),
          ...(data.dueAt ? {dueAt: data.dueAt} : {}),
          ...(data.expiresAt ? {expiresAt: data.expiresAt} : {}),
          ...(data.sourceEventId ? {sourceEventId: data.sourceEventId} : {}),
        });
        continue;
      }
      const source = sourceSchema.safeParse(event.data);
      if (source.success && event.type === 'feedback.source') {
        const record = records.get(source.data.feedbackId);
        if (record) records.set(record.id, {...record, sourceMessageId: source.data.sourceMessageId,
          ...(source.data.taskId ? {taskId: source.data.taskId} : {}), ...(source.data.runId ? {runId: source.data.runId} : {}),
          ...(source.data.intentVersion !== undefined ? {intentVersion: source.data.intentVersion} : {})});
        continue;
      }
      const unknown = unknownSchema.safeParse(event.data);
      if (unknown.success && event.type === 'feedback.unknown') {
        const record = records.get(unknown.data.feedbackId);
        if (record) records.set(record.id, {...record, state: 'unknown', deliveryId: unknown.data.deliveryId});
        continue;
      }
      const sending = sendingSchema.safeParse(event.data);
      if (sending.success && event.type === 'feedback.sending') {
        const record = records.get(sending.data.feedbackId);
        if (record) records.set(record.id, {...record, state: 'sending', deliveryId: sending.data.deliveryId, attempts: Math.max(record.attempts, sending.data.attempt)});
        continue;
      }
      const released = releasedSchema.safeParse(event.data);
      if (released.success && event.type === 'feedback.released') {
        const record = records.get(released.data.feedbackId);
        if (record) {
          const {deliveryId:_deliveryId, ...rest} = record;
          records.set(record.id, {...rest, state: 'pending', attempts: Math.max(record.attempts, released.data.attempt)});
        }
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
    const values = [...records.values()].filter(record => !record.expiresAt || Date.parse(record.expiresAt) > at)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    return includeNonPending ? values : values.filter(record => record.state === 'pending');
  }

  due(route: string, at = this.now()): FeedbackRecord[] {
    return this.pending(route, at).filter(record => record.kind === 'must-know' && record.dueAt !== undefined && Date.parse(record.dueAt) <= at);
  }

  /** Routes with persisted conversation events; feedback targets are conversation routes. */
  routes(): string[] {
    return this.journal.eventRoutes();
  }

  worthSharing(route: string, at = this.now()): FeedbackRecord[] {
    return this.pending(route, at).filter(record => record.kind === 'worth-sharing');
  }

  /** Claim one pending record for delivery. The returned attempt is 1-based. */
  claim(id: string, route: string, deliveryId: string): number | null {
    const record = this.pending(route, this.now(), true).find(item => item.id === id);
    if (!record || record.state !== 'pending') return null;
    const attempt = record.attempts + 1;
    this.append(randomUUID(), {route, traceId: id, operationId: id, type: 'feedback.sending', data: {feedbackId: id, deliveryId, attempt}});
    return attempt;
  }

  beginSend(id: string, route: string, deliveryId: string): number {
    const attempt = this.claim(id, route, deliveryId);
    if (attempt === null) throw new Error('FEEDBACK_NOT_PENDING');
    return attempt;
  }

  /** Settle a claimed delivery by its actual outcome. unknown never returns to pending. */
  settle(id: string, route: string, deliveryId: string, outcome: 'sent' | 'not-sent' | 'unknown', receiptId?: string, code?: string): void {
    if (outcome === 'sent') this.markSent(id, deliveryId, route, receiptId);
    else if (outcome === 'not-sent') this.release(id, route, code ?? 'NOT_SENT');
    else this.markUnknown(id, deliveryId, route, code ?? 'DELIVERY_UNKNOWN');
  }

  markUnknown(id: string, deliveryId: string, route: string, code: string): void {
    this.append(randomUUID(), {route, traceId: id, operationId: id, type: 'feedback.unknown',
      data: {feedbackId: id, deliveryId, code: code.slice(0, 120)}});
  }

  attachSource(id: string, route: string, source: {sourceMessageId: string; taskId?: string; runId?: string; intentVersion?: number}): void {
    this.append(randomUUID(), {route, traceId: id, operationId: id, type: 'feedback.source',
      data: {feedbackId: id, sourceMessageId: source.sourceMessageId, ...(source.taskId ? {taskId: source.taskId} : {}),
        ...(source.runId ? {runId: source.runId} : {}), ...(source.intentVersion !== undefined ? {intentVersion: source.intentVersion} : {})}});
  }

  legacyPending(): FeedbackRecord[] {
    return this.routes().flatMap(route => this.pending(route)).filter(record => !record.sourceMessageId);
  }

  unknownRecords(): FeedbackRecord[] {
    return this.routes().flatMap(route => this.pending(route, this.now(), true)).filter(record => record.state === 'unknown');
  }

  /** A definite not-sent result returns the obligation to pending for a later attempt. */
  release(id: string, route: string, reason: string): void {
    const record = this.pending(route, this.now(), true).find(item => item.id === id);
    if (!record) return;
    this.append(randomUUID(), {route, traceId: id, operationId: id, type: 'feedback.released',
      data: {feedbackId: id, reason: reason.slice(0, 120), attempt: Math.max(1, record.attempts)}});
  }

  markSent(id: string, deliveryId: string, route: string, receiptId?: string): void {
    this.terminal(id, route, 'feedback.sent', {feedbackId: id, deliveryId, ...(receiptId ? {receiptId} : {})});
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
