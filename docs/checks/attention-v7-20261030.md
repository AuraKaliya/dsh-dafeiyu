# 注意力层第七版：步骤级 RunLease 让出

日期：2026-10-30
基线：`d94c9be`
范围：用 DSH `agent/pre-step` 在模型步骤边界释放/重取 RunLease。
验证：`npm test` 249/249 通过（55 个单元测试文件）。

## 1. RunLeaseHandle

`RunScheduler.acquireHandle(lease)` 返回 `RunLeaseHandle`：

- 正常持有一个 run 名额；
- `yieldIfContended()`：
  - 只对非 `interactive` 类生效；
  - `status.foregroundWaiting === 0` 时不动作；
  - 有交互等待时释放名额，再等待重新准入；
  - 重新准入前聊天可以先拿到名额；
  - `close()` 后即使重取成功也立即释放，避免泄漏。
- `close()` 幂等，负责最终释放。

`ExecutionCoordinator.process` 从 `acquire(...)` 改为 `acquireHandle(...)`，任务 frame 带 `lease`；最终 `finally` 调 `close()`。

## 2. pre-step 挂钩

`NativeRuntime.run` 在任务 frame 有 lease 时注册：

```ts
owned.scope.on('agent/pre-step', async (_payload, next) => {
  frame.guard();
  await frame.lease!.yieldIfContended();
  frame.guard();
  return next();
});
```

- 只在 DSH 的步骤准入前执行；不在模型流中途、也不在工具执行中打断；
- 等待期间 run 不占 RunLease；聊天可先准入；
- 重取后再次 `frame.guard()`，取消/来源失效不会被忽略；
- 其他路径（会话、交付）仍用普通 `acquire`，不启用步骤级让出。

## 3. 语义边界

- 这不是 preempt：不会取消当前模型调用或工具；
- 不是 `pause`：不写 `paused` 检查点，任务仍由当前 run 继续；
- 让出点只在模型步骤边界；如果工具执行很长，RunLease 在工具期间仍被持有，下一步再让出；
- 交互等待才触发；没有聊天时任务不额外释放/重取。

## 4. 验证

- `tests/attention-scheduler.test.ts` 新增：
  - 任务持有唯一名额；
  - 聊天等待时 `yieldIfContended` 释放名额，聊天先获准入；
  - 聊天释放后任务重取；
  - `close()` 后名额归零。
- 全量 249/249。

## 5. 仍未完成

1. 反馈自动派发：复用 Activity/定时器，`due()` 先排除 unknown。
2. `ExecutionProducer.yield` 接入管理端动作列表；普通任务的主动让出策略。
3. 工具执行期间的让出：目前只在模型步骤前；长工具仍持名额。
4. 执行器 class 仍由 motivation 推导。
5. 真实 DSH 运行下的步骤级让出尚未做平台/模型验收。

## 6. 变更

- `packages/core/src/run-scheduler.ts`（RunLeaseHandle/acquireHandle）
- `packages/core/src/execution-coordinator.ts`（handle/frame lease）
- `packages/core/src/execution-frame.ts`（lease 字段）
- `packages/core/src/native-runtime.ts`（agent/pre-step）
- `tests/attention-scheduler.test.ts`
