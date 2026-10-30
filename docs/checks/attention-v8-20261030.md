# 注意力层第八版：反馈自动派发

日期：2026-10-30
基线：`dbec1e5`
范围：复用 Activity 定时器自动派发反馈账本中的到期/可分享项。
验证：`npm test` 251/251 通过（56 个单元测试文件）。

## 1. 账本状态扩展

`FeedbackLedger` 新增：

- `feedback.sending`：`beginSend(id, route, deliveryId)` 认领一条 pending，返回 1-based attempt；
- `feedback.released`：确定未发送时 `release(id, route, reason)` 回到 pending，attempts 保留；
- `pending()` 不再返回 `sending`；`attempts` 随 sending/released 递增；
- `routes()` 改用 `Journal.eventRoutes()`（distinct conversation routes），不再依赖 inbox 是否有消息。

自动派发最多 3 次；第 3 次后 pending 仍保留但不再重试，避免无限循环。

## 2. FeedbackDispatcher

`packages/core/src/feedback-dispatch.ts`：

- 先取所有 route 的 `due()`（must-know 到期），再取 `worthSharing()`；
- **must-know 可以在聊天进行中发送**；worth-sharing 只在 `interactiveActive=0` 且 `interactiveWaiting=0` 时发送；
- 每次 tick 最多 2 条；
- `beginSend` 后调用既有渠道队列交付；成功 `markSent` + `recordNotice`；确定未发送 `release` 回到 pending；
- 不生成文案、不新建调度器；target 必须已有 route/会话/channel。

## 3. Activity 定时器接线

`ActivityScheduler.tick()` 在每次 tick 开头调用：

```ts
try { await this.ctx.dafeiyu.dispatchFeedback?.(now); } catch {}
```

- 复用 Activity 的 `tickMs` 定时器，不新增 timer；
- 调用发生在 `pressure()` 早退之前，所以 must-know 到期不会被持续聊天无限推迟；
- worth-sharing 仍由 dispatcher 检查压力后决定；
- Activity 未启用/未 ready 时不会自动派发（当前限制）。

## 4. Core 接线

`Core.dispatchFeedback(now)`：

- `target(record)`：`journal.latestMessageId(record.route)` → `PendingMessage` → `deliveryChannel`；
- `deliver`：复用 `ConversationCoordinator.enqueueTaskDelivery`，构造 `Reply{ id: deliveryId }`，走现有 channel capability；
- `sent`：`recordNotice(...)` 写 `notice.attempt`，状态 sent；
- `pressure`：`RunScheduler.status.interactiveActive/interactiveWaiting`。

## 5. 测试

- `tests/feedback-dispatch.test.ts`：
  - 聊天进行中只发 must-know，worth-sharing 延迟到 idle；
  - 确定未发送回到 pending，3 次后停止重试；
- `tests/feedback-ledger.test.ts` 保持；
- 全量 251/251。

## 6. 仍未完成

1. **义务与文案仍未分离**：当前 `queue` 时已有 text；事实发生但生成失败的义务还不会先登记。
2. **崩溃恢复**：`feedback.sending` 卡住时不会自动核对回执/转 unknown；需要 deliveryId 对账。
3. **目标/版本复核**：发送前只校验 route 最新消息和 channel identity，未校验任务 epoch/目标版本；任务改目标后的旧反馈可能仍发送。
4. Activity 未启用时无自动派发；可考虑 Core 级 fallback timer，但会引入第二套定时器。
5. 真实 QQ/模型下的自动派发与重复发送验收未做。

## 7. 变更

- `packages/core/src/feedback-ledger.ts`
- `packages/core/src/feedback-dispatch.ts`（新增）
- `packages/core/src/index.ts`
- `packages/activity/src/scheduler.ts`
- `packages/journal/src/index.ts`（`eventRoutes`）
- `tests/feedback-dispatch.test.ts`（新增）、`tests/feedback-ledger.test.ts`
