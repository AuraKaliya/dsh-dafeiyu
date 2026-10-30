# 注意力层第九版：发送所有权、来源授权与取消传播

日期：2026-10-30
基线：`af2e3f7`
范围：处理 V8 复核四项 P1，并接通会话工作身份与协作式让出。
验证：`npm test` 258/258 通过（58 个单元测试文件）；未部署、未调用真实模型或平台。

## 1. 反馈发送统一认领

`FeedbackLedger`：

- `claim(id, route, deliveryId)` 只有 pending 才能认领，返回 1-based attempt；第二条入口拿 `null`；
- `settle(id, route, deliveryId, outcome, receiptId?, code?)`：
  - `sent` → 终态；
  - `not-sent` → 回 pending，attempts+1；
  - `unknown` → `feedback.unknown` 持久状态，**不再进入 pending**；
- `FeedbackDispatcher` 改用 claim/settle；unknown 不自动重发；
- `queue` 的去重范围包含 `sending`，避免原发送等待回执时又建一条 pending；
- `Core` 的 catch 用 `invoked` 区分：调用渠道前失败 → not-sent；调用后异常 → unknown。

两条原发送路径（`NativeTaskDelivery.statusNotice`、`deliverPublicProgress`）在真正发送前 claim；claim 失败（自动派发已拥有）就跳过，由持有者发送，并在收到回执后统一 settle。

## 2. 来源与迁移

- 反馈记录新增 `sourceMessageId`（原 inbound id）、`taskId`、`runId`、`intentVersion`；
- `Core.feedbackSourceCurrent` 发送前校验：
  - 原 inbound 仍存在；
  - 原消息未被撤回；
  - 任务 epoch 仍等于记录版本；
- `latestMessageId` 不再用于重新授权；回复的 `sourceMessageId` 用原消息的 external id；
- 启动迁移：`migrateFeedback()` 对缺少 source 的旧 pending，通过 run 的 `messageSource.inboundId` 补全；无法补全的标 `superseded`；
- unknown 启动对账：查同 route 的 `notice.attempt`，若同 deliveryId 有 sent 记录则补成 sent；否则保持 unknown、不重发。

## 3. 单调用取消传播

- `SharedModelBudget.callSignal(callId)` 暴露该调用的本地 abort signal；
- `model-admission` 用 `raceCall(iterator.next(), callSignal)`，超时/取消可以打断已经阻塞的读取；finally 仍 `iterator.return()` 并 settle；
- 本地取消后 usage 未知：`complete()` 不再 `cancelBudget`，其他会话可继续（按主人决定）；
- authority 对 unknown 计费的政策仍需实现：测试 fixture 用 `allowLocalUnknown` 模拟；真实 authority 若不接受，仍会在 `guard()` 处阻止后续调用；
- `raceCall` 正常完成时移除 abort listener，避免长流步骤累积监听器。

## 4. 会话身份与协作式让出

- `DshRuntime.run()` 入口绑定 `sessionId → interactive WorkCallContext`，finally 解绑；不再依赖默认值；
- `RunLeaseControl.requestYield()` 只置位，不 abort；
- `ExecutionCoordinator.control('yield')` 只调用当前 run 的 `requestYield()`，不写 cancelling、不改 run 状态；
- `IdleActivity` 不再设置 `work.paused`，只请求让出；`agent/pre-step` 在步骤边界释放/重取；
- 用户 `pause` 仍是独立控制状态。

## 5. 测试

- feedback ledger：claim 排他、unknown 不再可 claim、旧 pending 补 source；
- feedback dispatcher：unknown 停泊不重发、not-sent 3 次上限；
- server budget：本地 timeout + usage null 后其他调用可准入、callSignal 只中止本调用；
- model-admission：`raceCall` 在阻塞读取上 10ms 中止，已 abort 不进入读取；
- 全量 258/258。

## 6. 仍未完成

1. 真实渠道回执查询：unknown 对账目前只查 `notice.attempt`；渠道若不能按 deliveryId 查询，unknown 会一直停泊（符合不重发，但没有自动恢复）。
2. 原发送与自动派发共用了 claim/settle，但还不是一个独立 coordinator 类；逻辑分散在 Core/NativeTaskDelivery。
3. 来源校验未做真实 Core 集成测试（撤回/epoch 变化），只有 ledger 与 helper 测试。
4. 真实 authority 的 local-unknown 计费政策未实现；当前测试用 fixture 模拟。
5. `agent/pre-step` 的 `raceCall` 组合未在真实 DSH 会话中验收；长工具执行期间仍持有 RunLease。
6. 未部署、未调用真实模型或平台。

## 7. 变更

- `packages/core/src/feedback-ledger.ts`
- `packages/core/src/feedback-dispatch.ts`
- `packages/core/src/index.ts`
- `packages/core/src/native-task-delivery.ts`
- `packages/core/src/execution-coordinator.ts`
- `packages/core/src/run-scheduler.ts`
- `packages/core/src/runtime.ts`
- `packages/activity/src/idle.ts`
- `packages/server-runtime/src/shared-budget.ts`
- `packages/server-runtime/src/model-admission.ts`
- `tests/feedback-*.test.ts`、`tests/model-admission-abort.test.ts`、`tests/server-runtime-*.test.ts`
