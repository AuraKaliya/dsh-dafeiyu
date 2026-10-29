# P1：统一工作视图计划、能力索引上限与受控收缩

日期：2026-10-30
范围：P1。P2（预派发容量重建/重试、恢复文案兜底）未实施；未改人格提示词。

## 实现

### 1. WorkingViewPlan

新增 `packages/core/src/working-view.ts`：

- 一个可序列化的请求视图，按区域记录：
  - system / controlled-context / capability-index
  - runtime-context（含完整快照数量）
  - history / tool-results / current-input
  - tools / tool-history
  - retired-snapshots
- totals 同时记录：
  - `internalBytes`（本地内部对象/审计计量）
  - `wireBytes`（去掉 `source.sections` 的 wire 投影）
  - `auditBytes`、`estimatedInputTokens`、`runtimeSnapshots`、`retired`、`mediaBlocks`
- budgets 记录 requestMaxBytes、reserveBytes、modelContextWindow、reservedOutputTokens；
- `withinBudget` 与 `wireWithinBudget` 同时可见，但 P1 仍按原有内部上限做保护，wire 只作为诊断。

`ContextCoordinator.audit` 在 `context.admitted` 中新增 `workingView`，与已有 `capacity`、`plan`、`retired` 并列。

### 2. 能力索引硬上限

`renderCapabilityIndex`：

- 增加 `CAPABILITY_INDEX_MAX_BYTES = 16000`；
- 正常只保留名称、120 字内用途、真实版本；
- 超限时降级为可查询的壳：清空 callable/host tools/skills，保留版本/可用性/features，标记 `truncated: true`；
- 仍超限时进一步只保留最小索引；
- 输出中的 `version` 由最终内容哈希生成，内容不变时稳定。

### 3. 受控上下文收缩与有限重试

`ContextRuntime`：

- 新增 `allowanceOverride`、`repairRounds`；
- 请求超出本地预算且 `allowRepair` 为真时：
  1. 计算超出字节；
  2. 用 `shrinkControlledAllowance` 缩减受控上下文 allowance（至少 1 KB，最多扣到 0）；
  3. 记录 `context.repair` 事件；
  4. 设置 `retryPending`，返回 false，让 DSH 触发一次重试；
  5. 最多 2 次，之后仍不可容纳则报原有容量失败；
- `agent/request-error` 的 `DAFEIYU_CONTEXT_REASSEMBLE` 重试分支现在有实际状态可消费；
- `begin` 时重置 allowance/repair 状态，避免跨用户轮次继承。

### 4. 保持原有限制

- 没有把 1,000,000 字节内部上限改成 wire 上限；
- 没有删除来源/归档；
- 没有自动重放已执行操作；
- 没有改 P0 的快照最新一份策略。

## 本机检查

| 运行 | 结果 | 覆盖 |
|---|---|---|
| `ec16841d-970f-4e76-b2f5-927bf9461a11` | 15/15 | WorkingViewPlan、能力索引上限、wire 投影、allowance 收缩、P0 索引/快照、当前 API |
| `2f32cbf9-1221-40e7-bd53-8e939dc67a38` | 51/51 | 上述相关 + 当前 API/存储、记忆、检索、启动、运行时、native delivery、B站 |

构建：`node scripts/build.mjs` 通过。

## 未完成 / P2

- 预派发 `CONTEXT_REQUEST_CAPACITY` 后的重建 + 一次有限重试（P2）；
- 恢复模型普通正文的解析兜底、失败原因记录（P2）；
- 让历史/工具结果的压缩也直接消费 `WorkingViewPlan`（P1 已把计划记录完整，压缩器仍是现有旧回合/任务工具结果路径）；
- wire 上限是否最终替代本地审计上限，需要正式实例实测后再定；
- 真实长任务、重启、来源撤回、正式部署复测。

说明：P1 的计划是“统一账本 + 受控上下文收缩”，不是一次性重写所有模块。P0 已保证快照只留最新，P1 把剩余材料纳入同一份可审计视图，并在受控上下文超限时先减小可选材料。
