# P2：预派发容量重建与恢复正文兜底

日期：2026-10-30
范围：P2，仅普通会话；任务执行路径的容量恢复不在本轮。未改人格提示词。

## 实现

### 1. 预派发容量失败一次重建

`ContextRuntime.measure` 在 `inspectRequestCapacity` 抛 `CONTEXT_REQUEST_CAPACITY` 时：

- 仅当这是普通会话、尚未派发请求、且本轮还没用过容量重建时处理；
- 计算超出字节和缩减后的受控上下文 allowance（复用 `shrinkControlledAllowance`）；
- 记录 `context.repair` 事件，`phase: measure`；
- 设置 `allowanceOverride`、`capacityRepairUsed=true`、`retryPending=true`；
- 返回 false，让 `DshRuntime` 产出 `DAFEIYU_CONTEXT_REASSEMBLE`，由既有 `agent/request-error` 重试一次。

约束：

- 最多一次容量重建；
- 已确认的操作不回放；重建只重发尚未派发的模型请求；
- 第二次仍不可容纳则抛原容量错误，进入恢复/失败流程；
- P1 的受控上下文收缩仍最多 2 次，和这里的容量重建分开计数。

### 2. 恢复模型正文兜底

`conversation-recovery.ts` 新增 `parseRecoveryDecision`：

- 优先接受合法 JSON `{next,message}`；
- 如果模型只返回 `{message}`，取 message；
- 如果模型返回普通正文，直接作为 `message`，`next='wait'`；
- 空正文仍报 `RECOVERY_EMPTY`。

`renderConversationRecovery` 使用这个宽松解析；`decidePendingReplies` 仍保持严格 JSON。

### 3. 兜底状态带失败码

`notifyConversationFailure` 的固定兜底从：

> 【系统状态】刚才的处理未完成……

改为：

> 【系统状态】刚才的处理未完成（CONTEXT_REQUEST_CAPACITY……），进度和已有操作记录已保存；没有自动重做已执行的操作。

便于在没有恢复正文时直接定位错误类型。

## 本机检查

| 运行 | 结果 | 覆盖 |
|---|---|---|
| `c534b45f-e38b-4ccc-9791-831f56a31f89` | 18/18 | 恢复 JSON/正文/空输出、allowance 收缩、WorkingViewPlan、能力索引上限、P0 索引/快照、当前 API |
| `ceff4f22-3a1a-48ed-b246-1f69d40bfff8` | 51/51 | 上述相关 + 当前 API/存储、记忆、检索、启动、运行时、native delivery、B站 |

构建：`node scripts/build.mjs` 通过。

## 尚未验证 / 后续

- 真实长会话触发 `CONTEXT_REQUEST_CAPACITY` 后，重建是否一次成功；
- 重建后模型是否重复调用已执行过的工具（按设计不应自动重放，但需真实观察）；
- 任务执行路径的容量恢复；
- 正式部署后的重启、长任务、来源撤回和 QQ 回执验收。

本轮是模拟/本机测试，不是真实 QQ/B站端到端验收。
