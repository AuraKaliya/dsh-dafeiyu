# 注意力层第四版：取消作用域拆分

日期：2026-10-30
基线：`bceed81`
范围：Batch 2b 的第一块——`cancelCall / cancelRun / cancelBudget` 分离。
验证：`npm test` 247/247 通过（55 个单元测试文件）。

## 1. 三种取消

`SharedModelBudget`：

| 方法 | 作用范围 | 是否关闭 admission |
|---|---|---|
| `cancelCall(callId, code)` | 只中止一条已准入调用 | 否 |
| `cancelRun(runId, code)` | 中止携带该 `runId` 的 `CallLease` 的记录 | 否 |
| `cancelBudget(code)` | 全局停止：授权结束、usage 不确定、主机关闭 | 是 |

`CallLease` 新增 `runId`；`production.ts` 的父进程/执行器 lease 解析会带上 `work.runId`，因此 `cancelRun` 能按程序签发的工作身份匹配，不靠模型或子进程字段。

## 2. 单调用不再触发全局取消

`reserve()` 中：

- 调用方 `signal` abort 只 abort 本调用的 `abort` 控制器；
- 单调用 deadline 只 abort 本调用的控制器；
- 不再调用 `this.cancel(...)`。

`dispatchStep` 会在下一次迭代前检查 `record.abort.signal`，所以 `cancelCall`/`cancelRun` 能在下一个流式步中止该调用。

**用量差异**：

- 取消时如果调用方仍能给出已知 usage，`complete()` 保留该 usage，只把 finish 标为 `interrupted`；不会再因为“cancelled”把所有已知账单抹成 null。
- usage 为 null，或 authority 报 unknown，仍会 `cancelBudget('RUNTIME_USAGE_UNKNOWN')` 全局停止——这是财务安全边界，不是普通调度让出。
- `onInterrupt` 不再因单调用 deadline 触发；只由全局预算停止触发。

## 3. 测试

`tests/server-runtime-budget.test.ts` 新增/改写：

- 单调用 deadline 结算后，另一个调用仍可准入；
- `cancelCall` 中止一条调用后 gate 仍开放，settled 调用不能再次取消；
- `cancelRun` 只命中对应 `runId`，其他 run 的调用不受影响；
- 已知 usage 在取消后保留（finish=interrupted，usage 非 null）。

全量 247/247。

## 4. 仍未完成

1. `IdleActivity` 的 `pause` → `yield`：需要 ExecutionControl 增加资源让出语义；用户 pause 仍不自动恢复。
2. 执行器 job 创建时 `bindJob`：目前执行器调用仍可能未绑定 → interactive + 诊断。
3. 片段级 RunLease：DSH 有 `agent/pre-step` / `step/end`，下一步做可行性验证。
4. 反馈自动派发：复用 Activity/定时器；`due()` 需排除 unknown。
5. 普通 Run 的 `cancelRun` 调用接入：API 已就绪，尚未由注意力层主动调用（目前仍由 run signal 取消）。

## 5. 变更

- `packages/server-runtime/src/call-gate.ts`（`CallLease.runId`）
- `packages/server-runtime/src/shared-budget.ts`（三种取消、单调用 abort、usage 保留）
- `packages/server-runtime/src/production.ts`（lease 带 runId）
- `tests/server-runtime-budget.test.ts`
