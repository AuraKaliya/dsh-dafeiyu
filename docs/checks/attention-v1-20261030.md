# 注意力层第一版实现记录（RunLease + 通知回写）

> 后续：`attention-v2-20261030.md` 已补 CallLease（模型调用门排序）与反馈账本；第一版里的「CallLease / 反馈账本」条目以 v2 为准。

日期：2026-10-30
基线：`dec4326`（`d7ecfcc` 的下一提交），分支 `phase-1-core-host`。
范围：只实现第一版「运行准入 + 关注点亲和 + 对外通知回写」。没有改 DSH 本体，没有改共享预算的取消语义，没有引入第二套事件库。

## 一句话

把 `RunScheduler` 从「前台/后台两档名额」升级为 **RunLease 四类租约**：交互保留名额、后台并发上限、连续交互后的硬防饿死、聚焦路由的交互亲和、后台加权等待；同时把所有已发送的任务结果/进度/失败说明写成 `notice.sent` 日志，并通过 `sent-notices` 上下文区域回放给目标会话。

## 1. 已实现

### 1.1 RunLease 调度

`packages/core/src/run-scheduler.ts`

| 能力 | 实现 |
|---|---|
| 四类工作 | `interactive / owner-task / background / autonomy` |
| 交互预留 | `interactiveReserve`（默认 `limit>1 ? 1 : 0`）；后台并发上限 `limit - reserve` |
| 硬防饿死 | 后台 eligible 时，连续 `antiStarvation=3` 次交互派发后，下一次优先后台 |
| 后台公平 | 按「等待时间 / 权重」排序：owner-task 权重 2，其余后台 1；长等待后台可以超过新 owner-task |
| 交互亲和 | `noteInbound(route)` 维护 focus（TTL 5min、切换冷却 10s、亲和 2min）；同路由交互优先，不锁资源 |
| 兼容旧调用 | `acquire(boolean)` 仍可用，映射为 interactive/background |
| 诊断 | `status` 保留 `foregroundWaiting`，新增 interactive/background 计数；`onDecision` 回调 |

### 1.2 接入点

- `ConversationCoordinator.process()`：每轮先 `noteInbound(route)`，再以 `interactive` 租约申请名额，`maxDurationMs=turnTimeoutMs`。
- `ExecutionCoordinator.process()`：按动机映射 `owner-task / background / autonomy`；**主人委托的任务不再被当作交互前台**。
- `NativeTaskDelivery` 的交付渲染：以 `interactive` 租约申请名额（交付是用户可见工作）。
- `Core` 构造：`RunScheduler(limit,{interactiveReserve,antiStarvation:3,onDecision})`；非纯聊天派发写 `attention.decided` 事件（含 chosen/class/reason/等待/计数），供诊断。

### 1.3 通知回写

| 位置 | 行为 |
|---|---|
| `ConversationCoordinator.recordNotice()` | 把已发送文本写入 `notice.sent`（红action 后最多 4000 字；按 deliveryId 去重；失败不影响交付状态） |
| `NativeTaskDelivery.statusNotice` | 任务状态/失败通知发送成功后回写 |
| `NativeTaskDelivery` 结果交付 | `deliverTaskResult` / `deliverMedia` 完成后按 sent/not-sent/unknown 回写正文 |
| `NativeTaskDelivery.feedback` | 交付失败说明发送后回写 |
| `Core.deliverPublicProgress` | 模型主动进度发送后回写 |
| `registerSentNotices()` | `packages/core/src/notice-context.ts`：把当前 route 最近 6 条 notice 作为 `operational-fact` 区域装入，单条截 1200 字 |

这样主会话可以回答「我刚才跟主人说过什么」，而不是只看到任务结果摘要。

## 2. 明确不在本版

这些不是遗漏，而是依赖下一层改造，先不混进来：

1. **CallLease / ModelCallGate 优先级**：`ModelCallGate` 仍 FIFO。运行级预留只能保证「有 run 名额」，不能保证同一时刻的 model 调用顺序。需要 gate 接受 class/age，或由唯一 dispatcher 统一提交。
2. **共享预算的按调用取消**：`SharedModelBudget` 的 signal abort 仍走全局 `cancel()`（关闭 gate、abort 所有调用）。注意力 yield/preempt 不能在当前路径上使用，否则会取消正在回复的 QQ。必须先拆 `cancelCall / cancelRun / cancelBudget`。
3. **后台回合上限 3 次调用/90s**：需要 DSH 运行器暴露模型调用计数/步骤边界；当前由既有 `turnTimeoutMs` 提供总时长约束，租约里的 `maxDurationMs` 只记录、不单独强制。
4. **反馈账本分级/期限**：本版只有「已发送通知」的连续性记录，没有 `must-know` 到期兜底、`worth-sharing` TTL 队列。
5. **模型结构化建议**：没有 `dafeiyu_attention_suggest` 工具；注意力决定完全由程序按现有信号做出。
6. **ContextRequest 的 stage/purpose/material**：`ContextRequest` 仍是 conversation/sourceMessageId/signal；`contextManifest` 仍写死 `'conversation'`。
7. **任务结果「进主会话」的渲染**：没有把交付渲染搬回主会话；保持独立交付会话 + 核验，只把已发送正文作为 notice 回写。这是有意为之：隔离执行器污染，同时保证连续性。

## 3. 不变量

- 模型/扩展不能提交数字优先级或 authority；调度只看程序签发的 lease。
- `owner-task` 不是交互前台；交互名额只在 `interactive` 类使用。
- 后台并发不超过 `limit - interactiveReserve`；交互在后台等待时不能占满全部名额。
- 防饿死计数只在派发时变化；新消息不重置。
- 通知回写失败不改变交付回执；`notice.sent` 是连续性事实，不是发送事实的替代。
- 关注点是交互亲和，不是资源锁；后台执行不改变 focus。

## 4. 验证

新增：

- `tests/attention-scheduler.test.ts`：交互预留/后台并发上限、防饿死、focus 亲和、owner-task 权重、长等待后台反超、boolean 兼容。
- `tests/notice-context.test.ts`：按 route 读取 notice、来源引用、条数与文本。

已跑：

- `npm run build`：通过。
- 新增 7 项：通过。
- 相关回归 7 个文件 12 项：通过。
- `npm -- --smoke`：3 项通过。
- 全量 `npm test`：237 项全部通过（52 个单元测试文件；4.4s）。

## 5. 下一步（按依赖顺序）

1. 拆 `cancelCall/cancelRun/cancelBudget`；`SharedModelBudget` 的单调用 abort 不得触发全局 gate 关闭。
2. `ModelCallGate` 接受 CallLease（class/age/deadline），或由 AttentionRuntime 唯一提交。
3. 后台片段上限：DSH 运行器提供步骤/调用计数后，`maxDurationMs` 从记录变为强制。
4. 反馈账本：`must-know` 期限与 fallback、`worth-sharing` TTL、`progress` 静默；所有发送都回写。
5. `ContextRequest` 增加 stage/purpose/task/allowedDelivery；`ContextItem` 增加 material（下一版协议）。
6. 模型 `AttentionSuggestion`（无副作用工具）+ 程序校验。

## 6. 风险与回退

- 调度器行为变化会影响「谁先跑」；出问题可把 `interactiveReserve` 设为 0、`antiStarvation` 设为很大值，恢复接近旧的前台优先。
- `sent-notices` 区域会增加每轮上下文约 1–5KB；可在 `ContextBudget.regions` 中给它设更小的 `maxBytes`，或暂时不注册它。
- `attention.decided` 只在有等待/后台或非普通交互派发时写，避免聊天每轮增加一条事件。

## 7. 变更文件

- `packages/core/src/run-scheduler.ts`（重写）
- `packages/core/src/conversation-coordinator.ts`
- `packages/core/src/execution-coordinator.ts`
- `packages/core/src/native-task-delivery.ts`
- `packages/core/src/index.ts`
- `packages/core/src/notice-context.ts`（新增）
- `packages/journal/src/index.ts`（新增 `recentEvents(route,type,limit)`，避免每轮扫描整条会话事件）
- `tests/attention-scheduler.test.ts`（新增）
- `tests/notice-context.test.ts`（新增）
