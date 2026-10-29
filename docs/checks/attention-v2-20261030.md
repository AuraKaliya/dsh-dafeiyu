# 注意力层第二版：CallLease 与反馈账本

日期：2026-10-30
基线：`fd6085a`（第一版 RunLease + 通知回写）
范围：补上目标里剩余的 CallLease 与反馈账本。没有改 DSH 本体，没有新增存储 schema。

## 1. CallLease（模型调用门）

`packages/server-runtime/src/call-gate.ts` 从 FIFO 改为可选的调用级租约：

```ts
type CallClass = 'interactive' | 'owner-task' | 'delivery' | 'background' | 'autonomy';
interface CallLease { class: CallClass; workItemId?: string }
```

- `acquire(signal, deadline, lease?)`；不传 lease 保持原有 FIFO（现有调用与测试不受影响）。
- 类顺序：interactive → owner-task → delivery → background → autonomy。
- 等待 aging：每等待 `agingMs`（默认 5s）提升一档，长等待后台可超过新交互调用；不是模型给数字优先级。
- 失效先清理：取消/超时的 waiter 在排序前移除，不会抢占名额。
- `SharedModelBudget.reserve(raw, signal, lease?)` 透传；`installParentModelAdmission` 增加 `leaseFor(request)` 钩子。
- `production.ts` 默认把 `compaction` / `session-title` 映射为 background，其余 interactive；后续可按实际 purpose 扩展。

验证：`tests/server-runtime-call-gate.test.ts`（3 项）——交互优先、aging 反超、默认 FIFO。原有 budget 测试 11 项保持通过。

## 2. 反馈账本

`packages/core/src/feedback-ledger.ts`，基于现有 Journal，不建新库：

| 类型 | 语义 | 约束 |
|---|---|---|
| `must-know` | 承诺/失败/需要用户决定 | 必须有 `dueAt`；到期不能被模型沉默 |
| `worth-sharing` | 阶段成果/值得分享 | 有 `expiresAt`（默认 15min，调用方给） |
| `progress` | 普通进度 | 默认静默，不主动发 |

接口：

- `queue`：`workItemId + route + kind + text + dueAt/expiresAt`；相同 workItem/kind/text 只保留一条 pending。
- `pending(route)`：重放 `feedback.queued` 与 `feedback.sent/expired/superseded`；过期项不再返回。
- `due(route)`：到期 must-know。
- `worthSharing(route)`：当前有效 worth-sharing。
- `markSent(id, deliveryId, route)` / `expire` / `supersede`。

接入：

- `Core.deliverPublicProgress`：`blocked` → must-know（due now）、`progress` → worth-sharing（15min）、`intent` → progress；发送成功标 sent。
- `NativeTaskDelivery.statusNotice`：状态/失败通知入 must-know（due now），发送成功标 sent；失败保留 pending，便于后续查询/补发。
- 所有写入失败都只影响账本，不影响已经批准的实际交付。

验证：`tests/feedback-ledger.test.ts`（2 项）——三类分离、route 隔离、去重、due/sent/expire/supersede、must-know 必须有时限。

## 3. 与第一版的关系

- 第一版 RunLease 决定“哪个执行空间占运行名额”；本版 CallLease 决定“下一次模型调用给谁”；FocusLease 仍是 `RunScheduler.noteInbound` 的交互亲和，不锁资源。
- 三层租约的边界保持：Run 级只准入，Call 级只排序，Feedback 只记录与到期，不互相替代。
- `RunScheduler.focusLease` 暴露 FocusLease 快照（route / expiresAt / affinityUntil / switchCooldownUntil），供诊断与测试；关注点仍是软亲和，不锁资源。

## 4. 仍未完成（下一批）

1. **共享预算的按调用取消**：signal abort 仍走全局 `cancel()`；CallLease 只排序，不能安全 preempt。
2. **后台回合 3 次调用/90s**：需要 DSH 运行器步骤计数；当前由 `turnTimeoutMs` 约束。
3. **反馈自动到期发送**：账本有 `due()`，但没有定时 dispatcher；需要接入 Activity/定时器与人格渲染。
4. **模型结构化建议**、**ContextRequest stage/purpose/material**。

## 5. 验证与变更文件

- `npm run build`：通过。
- `npm test`：**242/242 通过**（54 个单元测试文件）。
- 新增：`tests/server-runtime-call-gate.test.ts`、`tests/feedback-ledger.test.ts`。
- 变更：
  - `packages/server-runtime/src/call-gate.ts`
  - `packages/server-runtime/src/shared-budget.ts`
  - `packages/server-runtime/src/model-admission.ts`
  - `packages/server-runtime/src/production.ts`
  - `packages/server-runtime/src/index.ts`
  - `packages/core/src/feedback-ledger.ts`（新增）
  - `packages/core/src/index.ts`
  - `packages/core/src/native-task-delivery.ts`
  - 两份测试、本记录
- 没有改存储 schema；`feedback.*` 都是既有 Journal 事件类型。
