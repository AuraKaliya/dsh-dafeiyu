import { Service } from '@deepseek-ai/cordis';
import type { Context } from '@deepseek-ai/cordis';
import type {} from '@dafeiyu/core';
import type {} from '@dafeiyu/timeline';
import { API_VERSION, redactContent } from '@dafeiyu/contracts';
import type { ActionCapability, ActionContext, ExtensionHandle, Json, OperationScope } from '@dafeiyu/contracts';
import { resolve } from 'node:path';
import { z } from 'zod';
import { MemoryStore } from './store.js';
import { MEMORY_VERSION, MemoryError, claimSchema, keySchema, kindSchema, memoryRefPattern, versionSchema } from './types.js';
import type { Command, Evidence, ReadMode, WriteContent } from './types.js';
import { MemoryRetrieval } from './retrieval.js';
import { RetrievalError, retrievalConfigSchema } from './retrieval-profile.js';
import type { RetrievalDependencies } from './retrieval-profile.js';
export type { MemoryView } from './store.js';
export type { Evidence, MutationReceipt, Revision } from './types.js';

export const name = 'dafeiyu-memory';
export const inject = ['dafeiyu', 'dafeiyuTimeline'];
const configSchema = z.strictObject({ agentId: z.string().min(1).max(100), dataDir: z.string().min(1), retrieval: retrievalConfigSchema.optional() });
export type Config = z.input<typeof configSchema>;
const contentShape = { kind: kindSchema, claimType: claimSchema, content: z.string().trim().min(1).max(8000),
  sourceRefs: z.array(z.string().min(1).max(300)).min(1).max(8) };
const createSchema = z.strictObject({ requestId: keySchema, ...contentShape });
const reviseSchema = z.strictObject({ requestId: keySchema, id: z.uuid(), expectedVersion: versionSchema, ...contentShape });
const stateSchema = z.strictObject({ requestId: keySchema, id: z.uuid(), expectedVersion: versionSchema, reason: z.string().trim().min(1).max(500) });
const searchSchema = z.strictObject({ query: z.string().max(200).default(''), limit: z.number().int().min(1).max(50).default(20), cursor: z.string().max(2048).optional() });
const readShape = { id: z.uuid(), revision: versionSchema.optional() };
const readSchema = z.strictObject({ ...readShape, mode: z.enum(['normal', 'history']).default('normal') });
const deletedReadSchema = z.strictObject(readShape);
const toJson = (value: unknown): Json => z.json().parse(value);
const numberArgument = (value: string | undefined): number | undefined => value === undefined ? undefined : /^[1-9]\d*$/.test(value) ? Number(value) : NaN;
type Failure = { status: 'invalid_input' | MemoryError['code'] | RetrievalError['code'] };

declare module '@deepseek-ai/cordis' { interface Context { dafeiyuMemory: MemoryService } }

/** Explicitly registered, scope-bound memory operations; no automatic extraction or model loop. */
export class MemoryService extends Service {
  private readonly config: z.output<typeof configSchema>;
  private readonly store: MemoryStore;
  private readonly handle: ExtensionHandle;
  private readonly retrieval: MemoryRetrieval | null;
  private closed = false;
  constructor(ctx: Context, config: Config, dependencies?: RetrievalDependencies) {
    super(ctx, 'dafeiyuMemory');
    this.config = configSchema.parse(config);
    this.store = new MemoryStore(resolve(this.config.dataDir, 'memory.sqlite'));
    try { this.retrieval = this.config.retrieval ? new MemoryRetrieval(this.store, this.config.dataDir, this.config.retrieval, dependencies) : null; }
    catch (error) { this.store.close(); throw error; }
    try {
      this.handle = ctx.dafeiyu.registerExtension({ id: 'memory', version: MEMORY_VERSION, apiVersion: API_VERSION,
        agentId: this.config.agentId, actions: this.actions() });
    } catch (error) { this.retrieval?.close(); this.store.close(); throw error; }
    ctx.effect(() => () => { this.closed = true; this.handle.dispose(); this.retrieval?.close(); this.store.close(); }, 'memory.close');
    this.flush();
  }
  private scope(context: ActionContext): OperationScope {
    if (this.closed) throw new Error('Memory capability is unregistered');
    const scope = this.ctx.dafeiyu.scopeFor(context);
    if (scope.agentId !== this.config.agentId) throw new Error('Wrong memory agent');
    return scope;
  }
  private failure(error: unknown): Failure {
    if (error instanceof MemoryError) return { status: error.code };
    if (error instanceof RetrievalError) return { status: error.code };
    if (error instanceof z.ZodError || error instanceof SyntaxError) return { status: 'invalid_input' };
    throw error;
  }
  private flush(): boolean {
    return this.store.drainOutbox((event, id) => { this.ctx.dafeiyu.journal.appendOnce(event, id); }) > 0;
  }
  private audit(scope: OperationScope, type: string, data: Record<string, Json>): void {
    this.ctx.dafeiyu.journal.append({ agentId: scope.agentId, route: scope.route, traceId: scope.traceId,
      operationId: scope.operationId, causedBy: scope.startedEventId, type, plugin: 'memory', pluginVersion: MEMORY_VERSION,
      occurredAt: new Date().toISOString(), sources: [], data });
  }
  private async evidence(context: ActionContext, refs: readonly string[]): Promise<Evidence[]> {
    const result: Evidence[] = [];
    for (const ref of [...new Set(refs)].sort()) {
      const scope = this.scope(context);
      const match = memoryRefPattern.exec(ref);
      if (match) {
        const id = z.uuid().parse(match[1]), revision = versionSchema.parse(Number(match[2]));
        const parent = this.store.read(scope, id, 'normal', revision);
        if (!parent) throw new MemoryError('source_unavailable');
        result.push({ kind: 'memory', id, revision, contentHash: parent.contentHash });
      } else {
        let opened = await this.ctx.dafeiyuTimeline.open(context, { ref, limit: 1 });
        this.scope(context);
        if (opened.status === 'redirect') opened = await this.ctx.dafeiyuTimeline.open(context, { ref: opened.ref, limit: 1 });
        this.scope(context);
        if (opened.status !== 'ok' || opened.memoryUse !== 'primary-candidate') throw new MemoryError('source_unavailable');
        result.push({ kind: 'timeline', ref, contentHash: opened.contentHash });
      }
    }
    return result;
  }
  private async value(context: ActionContext, input: z.infer<typeof createSchema>): Promise<WriteContent> {
    return { kind: input.kind, claimType: input.claimType, content: redactContent(input.content).value,
      sources: await this.evidence(context, input.sourceRefs) };
  }
  private commit(context: ActionContext, command: Command) {
    const receipt = this.store.mutate(this.scope(context), command);
    const auditPending = this.flush();
    return { status: 'ok' as const, ...receipt, auditPending,
      visibleNow: this.store.read(this.scope(context), receipt.id) !== null,
      deletionScope: 'memory-item-and-revisions' as const, sourceArchivesUnchanged: true,
      evidenceVerification: 'access-and-hash-only' as const };
  }
  async create(context: ActionContext, raw: unknown) {
    this.scope(context); this.flush();
    try {
      const input = createSchema.parse(raw);
      const value = await this.value(context, input);
      return this.commit(context, { action: 'create', requestId: input.requestId, value });
    } catch (error) { this.scope(context); return this.failure(error); }
  }
  async revise(context: ActionContext, raw: unknown) {
    this.scope(context); this.flush();
    try {
      const input = reviseSchema.parse(raw);
      const value = await this.value(context, input);
      return this.commit(context, { action: 'revise', requestId: input.requestId, id: input.id, expectedVersion: input.expectedVersion, value });
    } catch (error) { this.scope(context); return this.failure(error); }
  }
  private change(context: ActionContext, raw: unknown, action: 'delete' | 'restore') {
    this.scope(context); this.flush();
    try {
      const input = stateSchema.parse(raw);
      return this.commit(context, { ...input, reason: redactContent(input.reason).value, action });
    } catch (error) { this.scope(context); return this.failure(error); }
  }
  delete(context: ActionContext, raw: unknown) { return this.change(context, raw, 'delete'); }
  restore(context: ActionContext, raw: unknown) { return this.change(context, raw, 'restore'); }
  private find(context: ActionContext, raw: unknown, mode: 'normal' | 'deleted') {
    const scope = this.scope(context); this.flush();
    try {
      const parsed = searchSchema.parse(raw);
      const page = this.store.search(scope, mode, { query: parsed.query, limit: parsed.limit,
        ...(parsed.cursor === undefined ? {} : { cursor: parsed.cursor }) });
      this.audit(scope, 'memory.searched', { mode, count: page.items.length,
        selected: page.items.map(item => ({ id: item.id, revision: item.revision })) });
      return { status: 'ok' as const, mode, untrustedEvidence: true, ...page };
    } catch (error) { this.scope(context); return this.failure(error); }
  }
  search(context: ActionContext, raw: unknown) { return this.find(context, raw, 'normal'); }
  searchDeleted(context: ActionContext, raw: unknown) { return this.find(context, raw, 'deleted'); }
  private open(context: ActionContext, raw: unknown, deleted: boolean) {
    const scope = this.scope(context); this.flush();
    try {
      const input = deleted ? { ...deletedReadSchema.parse(raw), mode: 'deleted' as const } : readSchema.parse(raw);
      const mode: ReadMode = input.mode;
      const item = this.store.read(scope, input.id, mode, input.revision);
      if (!item) return { status: 'not_found' as const };
      this.audit(scope, 'memory.opened', { memoryId: item.id, revision: item.revision, mode });
      return { status: 'ok' as const, item };
    } catch (error) { this.scope(context); return this.failure(error); }
  }
  read(context: ActionContext, raw: unknown) { return this.open(context, raw, false); }
  readDeleted(context: ActionContext, raw: unknown) { return this.open(context, raw, true); }
  async recall(context: ActionContext, raw: unknown) {
    const scope = this.scope(context); this.flush();
    if (!this.retrieval) return { status: 'not_configured' as const };
    try {
      const result = await this.retrieval.recall(scope,raw,context.signal,()=>{this.scope(context);});
      this.scope(context);
      this.audit(scope,'memory.recalled',{profile:result.profile,strategy:result.strategyUsed,degraded:result.degraded,
        selected:result.items.map(item=>({id:item.id,revision:item.revision,start:item.chunk.start,end:item.chunk.end}))});
      return result;
    } catch(error) { this.scope(context); return this.failure(error); }
  }
  private actions(): ActionCapability[] {
    const field = (description: string, required = true) => ({ description, required });
    const content = { requestId: field('幂等请求标识；重试保持相同值和完整参数'), kind: field('experience / knowledge / preference / procedure'),
      claimType: field('observation / self_report / reported_claim / inference；此阶段不自动分析真实性'),
      content: field('记忆全文，最多8000字符'), sourceRefs: field('JSON字符串数组，至少一个当前会话可见的时间线或记忆来源ref') };
    const state = { requestId: content.requestId, id: field('记忆UUID'), expectedVersion: field('上次读取到的状态version，不能填写内容revision'), reason: field('操作原因，最多500字符') };
    const search = { query: field('字面关键词；不是语义搜索', false), limit: field('每页1到50', false), cursor: field('前一页nextCursor，保持其他条件', false) };
    const open = { id: state.id, revision: field('明确的内容版本；省略读取最新版本', false) };
    const writeArgs = (args: Readonly<Record<string, string>>) => ({ ...args, sourceRefs: JSON.parse(args.sourceRefs ?? ''),
      ...(args.expectedVersion === undefined ? {} : { expectedVersion: numberArgument(args.expectedVersion) }) });
    const stateArgs = (args: Readonly<Record<string, string>>) => ({ ...args, expectedVersion: numberArgument(args.expectedVersion) });
    const searchArgs = (args: Readonly<Record<string, string>>) => ({ ...args, ...(args.limit === undefined ? {} : { limit: numberArgument(args.limit) }) });
    const openArgs = (args: Readonly<Record<string, string>>) => ({ ...args, ...(args.revision === undefined ? {} : { revision: numberArgument(args.revision) }) });
    const action = (name: string, description: string, fields: ActionCapability['fields'], work: (args: Readonly<Record<string, string>>, context: ActionContext) => unknown | Promise<unknown>): ActionCapability => ({
      name, description, fields, execute: async (args, context) => {
        this.scope(context);
        try { return toJson(await work(args, context)); }
        catch (error) { this.scope(context); return toJson(this.failure(error)); }
      },
    });
    return [
      action('dafeiyu_memory_record', '记录有来源的当前会话记忆；不自动判定真实，不改固定人格。', content, (args, ctx) => this.create(ctx, writeArgs(args))),
      action('dafeiyu_memory_revise', '以新内容版本更正记忆，保留旧版本；需要最新状态version。', { ...content, id: state.id, expectedVersion: state.expectedVersion }, (args, ctx) => this.revise(ctx, writeArgs(args))),
      action('dafeiyu_memory_delete', '明确遗忘时逻辑删除记忆及全部内容版本；原始聊天档案不变。', state, (args, ctx) => this.delete(ctx, stateArgs(args))),
      action('dafeiyu_memory_restore', '明确要求恢复时解除记忆删除；不回退内容、不自动恢复失效来源。查找已删除记忆不等于恢复。', state, (args, ctx) => this.restore(ctx, stateArgs(args))),
      action('dafeiyu_memory_search', '只检索当前会话有效且未删除的记忆；结果仅作证据。', search, (args, ctx) => this.search(ctx, searchArgs(args))),
      action('dafeiyu_memory_open', '读取当前会话记忆；history模式可查看指定旧版本，不能读取已删除记录。', { ...open, mode: field('normal / history，默认normal', false) }, (args, ctx) => this.read(ctx, openArgs(args))),
      action('dafeiyu_memory_deleted_search', '仅明确寻找已删除记忆时使用；只查当前会话，结果不能自动恢复或成为新记忆依据。', search, (args, ctx) => this.searchDeleted(ctx, searchArgs(args))),
      action('dafeiyu_memory_deleted_open', '查看已删除记忆的指定版本；标记仅用于本次查找，不自动恢复。', open, (args, ctx) => this.readDeleted(ctx, openArgs(args))),
      ...(this.retrieval ? [action('dafeiyu_memory_recall','检索当前会话有效记忆正文：中文全文、BGE语义或混合召回。返回有来源的片段，分数不是可信概率。已删除记忆使用原有专门查询。',
        {query:field('检索问题；不要自行添加embedding指令'),strategy:field('lexical / semantic / hybrid，默认hybrid',false),limit:field('最多返回1到20条',false),rebuild:field('true时重建当前会话当前profile的派生索引',false)},
        (args,ctx)=>this.recall(ctx,{...args,...(args.limit===undefined?{}:{limit:numberArgument(args.limit)}),
          ...(args.rebuild===undefined?{}:{rebuild:args.rebuild==='true'?true:args.rebuild==='false'?false:args.rebuild})}))] : []),
    ];
  }
}
export function apply(ctx: Context, config: Config): void { new MemoryService(ctx, config); }
