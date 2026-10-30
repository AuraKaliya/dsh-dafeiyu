# 注意力层第三版：通知边界、权重修正与 WorkCallContext

日期：2026-10-30
基线：`4add2db`
范围：Batch 1（三条回归）+ Batch 2a（工作身份贯穿父进程/执行器入口）。
验证：`npm test` 245/245 通过（55 个单元测试文件）；未部署、未调用真实模型或平台。

## 1. 通知模型：`notice.attempt`

### 1.1 新事件

`ConversationCoordinator.recordNotice` 现在写 `notice.attempt`，不再写 `notice.sent`；旧事件不做兼容读取（按本轮决定，不做刻意兼容层）。

每次尝试是一条不可变事实：

```ts
{ deliveryId, status: 'sent'|'not-sent'|'unknown', kind, text, textHash, receiptId?, code? }
```

去重只针对**完全相同的状态事实**（deliveryId + status + textHash + receiptId + code）；同一 deliveryId 的 `not-sent → sent`、`unknown → sent` 会追加新事实，不再被首次记录挡掉。

### 1.2 当前视图

`buildNoticeViews` 按 deliveryId 归并：

- 状态优先级 `sent > unknown > not-sent`；
- 只有 `sent` 视图带正文（1200 字）；`not-sent` / `unknown` 只带状态、原因码、长度、哈希，不带草稿正文；
- 视图的 `eventId/at/textHash` 取最高状态对应的尝试，排序用该交付最新一次尝试的 seq；
- 装配端最多取 6 个不同 deliveryId，避免同一交付的多次尝试挤占区域。

这修掉了两个问题：未发送草稿进入上下文；后续成功确认被早先 `not-sent` 挡掉。也保留了 `unknown` 的“可能已发送”提示，但不会把完整草稿当成对方见过的内容。

**注意**：旧 `notice.sent` 事件不再被装配读取。这是有意的取舍；如果历史会话需要回放旧通知，需要一次性迁移或兼容读取（未做）。

## 2. 主人任务权重与服务计账

`RunScheduler.pickBackground` 改为：

```ts
score = waitedMs * weight - servedMs
```

- owner-task 权重 2，其余后台 1；相同非零等待下 owner 先；
- 释放 lease 时按 workItem 累计 `servedMs`；已获得大量服务的 owner 不再凭等待无限压住新后台；
- `servedMs` 上限 1024 个 workItem，`forget(workItemId)` 可显式清理；
- 测试补了非零等待、长等待后台反超、已服务 owner 不再优先。

## 3. WorkCallContext

### 3.1 契约

`packages/contracts/src/work-context.ts`：

```ts
interface WorkCallContext {
  workItemId; runId; scopeKey; class; targetVersion; stage;
}
```

`WorkContextRegistry` 提供 `bindSession/resolveSession`、`bindJob/resolveJob`、`noteUnbound`、`diagnostics`。进程内单例 `workContexts`；模型输出、扩展参数、执行器子进程数据只能作为查找键，不能提供 class/身份。

### 3.2 绑定

- `DshRuntime.runFrame` 在每次会话/任务执行前绑定 `sessionId → WorkCallContext`，执行结束解绑；
- 会话：`interactive`，stage `conversation`；
- 任务执行：`owner-task/background/autonomy`（按动机），stage `execution`，带 task epoch；
- 任务复核：同一 class，stage `review`。

### 3.3 调用入口

- `installParentModelAdmission` 的 `leaseFor` 现在拿到 `{purpose, sessionId}`；
- `production.ts` 先查 `workContexts.resolveSession(sessionId)`；命中则用真实 class/workItemId；
- `compaction/session-title` 仍映射 background；
- 未绑定：**interactive + `workContexts.noteUnbound(...)` 诊断**（本轮选定过渡默认），不再只按 purpose 猜；
- 执行器路径：`SharedModelBudget` 新增 `leaseFor(request)` 选项，按 `owner.jobId` 查 job 绑定；未绑定 job 记诊断并暂用 interactive。

**仍未完成**：Core 还没有在创建执行器 job 时 `bindJob`，所以执行器调用目前仍会走“未绑定 → interactive + 诊断”。父进程路径已真实。

## 4. 测试

- 新增 `tests/work-context.test.ts`（绑定/解绑/诊断）；
- `tests/notice-context.test.ts` 覆盖 sent/not-sent/unknown、not-sent→sent、视图无草稿正文；
- `tests/attention-scheduler.test.ts` 覆盖非零等待权重、servedMs 反超；
- `tests/server-runtime-call-gate.test.ts` 保持 3 项；
- 全量 245/245。

## 5. 仍未完成

1. 执行器 job → WorkCallContext 的实际绑定（目前只到 resolver 与诊断）。
2. 取消作用域拆分（`cancelCall/cancelRun/cancelBudget`）；`SharedModelBudget` 的 signal abort 仍全局 `cancel()`。
3. `IdleActivity` 的 `pause` → `yield`；需要 ExecutionControl 增加资源让出语义。
4. 反馈自动派发（复用 Activity/定时器）。
5. 片段级 RunLease（受 DSH step 钩子限制）。

## 6. 变更文件

- `packages/contracts/src/work-context.ts`（新增）、`contracts/index.ts`
- `packages/core/src/runtime.ts`、`execution-frame.ts`、`execution-coordinator.ts`
- `packages/core/src/notice-context.ts`、`conversation-coordinator.ts`、`native-task-delivery.ts`
- `packages/core/src/run-scheduler.ts`
- `packages/server-runtime/src/model-admission.ts`、`production.ts`、`shared-budget.ts`
- `tests/work-context.test.ts`（新增）、`tests/notice-context.test.ts`、`tests/attention-scheduler.test.ts`
- `packages/plugin/src/prompt-catalog.ts`（构建生成 hash 更新）
