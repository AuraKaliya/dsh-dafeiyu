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
import { MemoryAnalysis } from './analysis.js';
import { AnalysisError, analysisConfigSchema } from './analysis-types.js';
import { WorkingMemory } from './working.js';
import { ToolFeedbackArchive,feedbackConfigSchema } from './feedback.js';
export type { MemoryView } from './store.js';
export type { Evidence, MutationReceipt, Revision } from './types.js';

export const name = 'dafeiyu-memory';
export const inject = ['dafeiyu', 'dafeiyuTimeline', 'llm'];
const configSchema = z.strictObject({ agentId: z.string().min(1).max(100), dataDir: z.string().min(1), retrieval: retrievalConfigSchema.optional(), analysis:analysisConfigSchema.optional(),context:z.strictObject({}).optional(),feedback:feedbackConfigSchema.optional() });
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
type Failure = { status: 'invalid_input' | MemoryError['code'] | RetrievalError['code'] | AnalysisError['code'] };

declare module '@deepseek-ai/cordis' { interface Context { dafeiyuMemory: MemoryService } }

/** Scope-bound memory operations with opt-in independent analysis through the official DSH loop. */
export class MemoryService extends Service {
  private readonly config: z.output<typeof configSchema>;
  private readonly store: MemoryStore;
  private readonly handle: ExtensionHandle;
  private readonly retrieval: MemoryRetrieval | null;
  private readonly analysis: MemoryAnalysis | null;
  private readonly working:WorkingMemory|null;
  private readonly feedbackArchive:ToolFeedbackArchive|null;
  private closed = false;
  constructor(ctx: Context, config: Config, dependencies?: RetrievalDependencies) {
    super(ctx, 'dafeiyuMemory');
    this.config = configSchema.parse(config);
    this.store = new MemoryStore(resolve(this.config.dataDir, 'memory.sqlite'));
    try { this.retrieval = this.config.retrieval ? new MemoryRetrieval(this.store, this.config.dataDir, this.config.retrieval, dependencies) : null; }
    catch (error) { this.store.close(); throw error; }
    try { this.analysis=this.config.analysis?new MemoryAnalysis(ctx,this.store,this.config.dataDir,this.config.analysis):null; }
    catch(error){this.retrieval?.close();this.store.close();throw error;}
    try{this.working=this.config.context?new WorkingMemory(ctx,this.store,this.retrieval,this.config.dataDir,(c,refs)=>this.evidence(c,refs)):null;}
    catch(error){void this.analysis?.close();this.retrieval?.close();this.store.close();throw error;}
    try{this.feedbackArchive=this.config.feedback?new ToolFeedbackArchive(ctx,this.store,this.config.dataDir,this.config.feedback,(c,refs)=>this.evidence(c,refs)):null;}
    catch(error){this.working?.close();void this.analysis?.close();this.retrieval?.close();this.store.close();throw error;}
    try {
      this.handle = ctx.dafeiyu.registerExtension({ id: 'memory', version: MEMORY_VERSION, apiVersion: API_VERSION,
        agentId: this.config.agentId, actions: this.actions(),contexts:this.working?.contributors()??[],
        ...(this.feedbackArchive?{feedbackProvider:this.feedbackArchive}:{}) });
    } catch (error) { this.feedbackArchive?.close();this.working?.close();void this.analysis?.close(); this.retrieval?.close(); this.store.close(); throw error; }
    ctx.effect(() => async () => { this.closed = true; this.handle.dispose(); await this.analysis?.close();this.feedbackArchive?.close();this.working?.close(); this.retrieval?.close(); this.store.close(); }, 'memory.close');
    this.flush();
    this.analysis?.start();
  }
  private scope(context: ActionContext): OperationScope {
    if (this.closed) throw new Error('Memory capability is unregistered');
    const scope = this.ctx.dafeiyu.scopeFor(context);
    if (scope.agentId !== this.config.agentId) throw new Error('Wrong memory agent');
    return scope;
  }
  private failure(error: unknown): Failure {
    if(error instanceof AnalysisError)return {status:error.code};
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
  async analyze(context:ActionContext,raw:unknown){
    this.scope(context);
    if(!this.analysis)return {status:'not_configured'};
    try{return await this.analysis.submit(context,raw);}catch(error){this.scope(context);return this.failure(error);}
  }
  analysisStatus(context:ActionContext,id:unknown){
    this.scope(context);
    try{return this.analysis?.status(context,id)??{status:'not_configured'};}catch(error){return this.failure(error);}
  }
  async analysisInspect(context:ActionContext,id:unknown){
    this.scope(context);
    try{return await this.analysis?.inspect(context,id)??{status:'not_configured'};}catch(error){this.scope(context);return this.failure(error);}
  }
  analysisCancel(context:ActionContext,id:unknown){
    this.scope(context);
    try{return this.analysis?.cancel(context,id)??{status:'not_configured'};}catch(error){return this.failure(error);}
  }
  async whenAnalysisIdle():Promise<void>{await this.analysis?.whenIdle();}
  async updateWorking(context:ActionContext,raw:unknown){this.scope(context);try{return await this.working?.update(context,raw)??{status:'not_configured'};}catch(e){this.scope(context);return this.failure(e);}}
  selectContext(context:ActionContext,raw:unknown){this.scope(context);try{return this.working?.select(context,raw)??{status:'not_configured'};}catch(e){return this.failure(e);}}
  async retrieveContext(context:ActionContext,raw:unknown){this.scope(context);try{return await this.working?.retrieve(context,raw)??{status:'not_configured'};}catch(e){this.scope(context);return this.failure(e);}}
  clearContext(context:ActionContext,raw:unknown){this.scope(context);try{return this.working?.clear(context,raw)??{status:'not_configured'};}catch(e){return this.failure(e);}}
  contextStatus(context:ActionContext){this.scope(context);return this.working?.status(context)??{status:'not_configured'};}
  feedbackOpen(context:ActionContext,raw:unknown,deleted=false){this.scope(context);try{return this.feedbackArchive?.open(context,raw,deleted)??{status:'not_configured'};}catch(e){return this.failure(e);}}
  feedbackList(context:ActionContext,raw:unknown){this.scope(context);try{return this.feedbackArchive?.list(context,raw)??{status:'not_configured'};}catch(e){return this.failure(e);}}
  feedbackDelete(context:ActionContext,raw:unknown){this.scope(context);try{return this.feedbackArchive?.change(context,raw,true)??{status:'not_configured'};}catch(e){return this.failure(e);}}
  feedbackRestore(context:ActionContext,raw:unknown){this.scope(context);try{return this.feedbackArchive?.change(context,raw,false)??{status:'not_configured'};}catch(e){return this.failure(e);}}
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
      ...(this.feedbackArchive?[
        {...action('dafeiyu_tool_feedback_open','只读回查当前会话的已归档工具原文（已脱敏），不重新执行原工具。history仅用于显式查看过时来源。',
          {ref:field('反馈归档ref'),expectedVersion:field('归档状态版本'),mode:field('normal/history，默认normal',false),section:field('document/data/diagnostics/receipts，默认document',false),offset:field('Unicode码点偏移，默认0',false),limit:field('每页字符数',false),cursor:field('上页nextCursor；有cursor时不要再传offset',false)},
          (args,ctx)=>this.feedbackOpen(ctx,{...args,expectedVersion:Number(args.expectedVersion),...(args.offset===undefined?{}:{offset:Number(args.offset)}),...(args.limit===undefined?{}:{limit:Number(args.limit)})})),feedback:'archive-view' as const},
        {...action('dafeiyu_tool_feedback_deleted_open','仅明确寻找已删除工具反馈时使用；只查本会话，不恢复、不重新执行。本次回查内容不能自动成为新记忆。',
          {ref:field('反馈归档ref'),expectedVersion:field('最新状态版本'),section:field('document/data/diagnostics/receipts',false),offset:field('Unicode码点偏移',false),limit:field('每页字符数',false),cursor:field('上页nextCursor',false)},
          (args,ctx)=>this.feedbackOpen(ctx,{...args,expectedVersion:Number(args.expectedVersion),...(args.offset===undefined?{}:{offset:Number(args.offset)}),...(args.limit===undefined?{}:{limit:Number(args.limit)})},true)),feedback:'archive-view' as const},
        action('dafeiyu_tool_feedback_list','列出本会话最近的工具反馈索引，不返回正文。更早记录通过时间线feedback.archived事件定位。明确查找删除记录时选择deleted；查看过时来源时选择history。',
          {mode:field('normal/history/deleted，默认normal',false),limit:field('最多1至50条',false)},(args,ctx)=>this.feedbackList(ctx,{...args,...(args.limit===undefined?{}:{limit:Number(args.limit)})})),
        action('dafeiyu_tool_feedback_delete','逻辑删除反馈归档并撤下受控反馈视图；保留原文，不改变原操作副作用或来源记忆。',
          {ref:field('反馈归档ref'),expectedVersion:field('状态版本'),requestId:field('幂等标识'),reason:field('删除原因')},(args,ctx)=>this.feedbackDelete(ctx,{...args,expectedVersion:Number(args.expectedVersion)})),
        action('dafeiyu_tool_feedback_restore','明确恢复归档的自身删除标记；不恢复已删除来源、不重新执行工具。',
          {ref:field('反馈归档ref'),expectedVersion:field('状态版本'),requestId:field('幂等标识'),reason:field('恢复原因')},(args,ctx)=>this.feedbackRestore(ctx,{...args,expectedVersion:Number(args.expectedVersion)})),
      ]:[]),
      ...(this.working?[
        action('dafeiyu_memory_working_set','替换当前会话的工作状态。只返回回执，来源校验后由核心在下次请求装配。不会自动提炼分析报告。',
          {requestId:field('幂等标识'),expectedVersion:field('工作区状态版本，首次0'),taskId:field('当前任务标识'),expiresAt:field('有效期ISO时间，24小时以内'),items:field('JSON数组：id、category(goal/constraint/correction/pending/result/gap)、text、sourceRefs')},
          (args,ctx)=>this.updateWorking(ctx,{...args,expectedVersion:Number(args.expectedVersion),items:JSON.parse(args.items??'')})),
        action('dafeiyu_memory_context_select','选择有效记忆片段供核心装配；必须携带读取时的版本、哈希及Unicode码点范围。不直接写入聊天消息。',
          {requestId:field('幂等标识'),expectedVersion:field('检索证据区状态版本，首次0'),taskId:field('当前任务标识'),expiresAt:field('有效期ISO时间，24小时以内'),items:field('JSON数组：id、revision、version、contentHash、start、end')},
          (args,ctx)=>this.selectContext(ctx,{...args,expectedVersion:Number(args.expectedVersion),items:JSON.parse(args.items??'')})),
        action('dafeiyu_memory_context_retrieve','内部检索并选择前若干有效记忆完整分片；仅返回回执，完整命中列表和分析结果不注入聊天。',
          {requestId:field('幂等标识'),expectedVersion:field('检索证据区版本，首次0'),taskId:field('当前任务标识'),expiresAt:field('有效期ISO时间，24小时以内'),query:field('检索问题'),strategy:field('lexical/semantic/hybrid',false),limit:field('最多1至12条，默认3',false)},
          (args,ctx)=>this.retrieveContext(ctx,{...args,expectedVersion:Number(args.expectedVersion),...(args.limit?{limit:Number(args.limit)}:{})})),
        action('dafeiyu_memory_context_status','查询工作区和证据区版本与存储条数；不返回记忆正文，不表示全部条目已获准装配。',{},(_args,ctx)=>this.contextStatus(ctx)),
        action('dafeiyu_memory_context_clear','清空所选装配区；保留长期记忆与审计，旧受控快照将在下一请求前退出。',
          {requestId:field('幂等标识'),kind:field('working/evidence'),expectedVersion:field('该区状态版本')},
          (args,ctx)=>this.clearContext(ctx,{...args,expectedVersion:Number(args.expectedVersion)})),
      ]:[]),
      ...(this.analysis?[
        action('dafeiyu_memory_analyze','提交独立后台记忆分析。只读当前会话的给定来源；符合保守规则的候选自动提交，分析全文不会自动写入当前聊天。',
          {requestId:field('幂等任务标识'),sourceRefs:field('JSON来源ref数组'),targetIds:field('允许更正的已有记忆UUID数组，默认[]',false)},
          (args,ctx)=>this.analyze(ctx,{...args,sourceRefs:JSON.parse(args.sourceRefs??''),targetIds:JSON.parse(args.targetIds??'[]')})),
        action('dafeiyu_memory_analysis_status','查询本会话分析任务状态和计数；不返回分析正文。',{jobId:field('任务UUID')},(args,ctx)=>this.analysisStatus(ctx,args.jobId)),
        action('dafeiyu_memory_analysis_open','明确需要查看分析时使用；返回结构化结论与候选，属于不可信分析证据，不能自动成为新记忆来源。',{jobId:field('任务UUID')},(args,ctx)=>this.analysisInspect(ctx,args.jobId)),
        action('dafeiyu_memory_analysis_cancel','取消本会话尚未完成的分析；已提交的记忆不回滚，需单独更正或逻辑删除。',{jobId:field('任务UUID')},(args,ctx)=>this.analysisCancel(ctx,args.jobId)),
      ]:[]),
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
