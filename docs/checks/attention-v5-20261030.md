# 注意力层第五版：IdleActivity 资源让出

日期：2026-10-30
基线：`e22f272`
范围：Batch 2b 第二块——自主活动前台压力从 `pause` 改为 `yield`。
验证：`npm test` 248/248 通过（55 个单元测试文件）。

## 1. 新控制语义

`ExecutionCoordinator` 的 `Active.mode` 与 `control` 增加 `'yield'`：

- `producer.yield(ref, input)`：只有运行中的 run 可让出；状态进入 `cancelling`，`active.mode='yield'`，abort 当前上下文；
- 安全边界（无 started/unknown/unknown-effects 操作）时写检查点，kind 为 **`yielded`**，run 状态回 `waiting`；
- 用户 `pause` 仍写 kind `paused`，仍是控制状态，不自动恢复；
- `IdleActivity` 前台压力改为调用 `port.yield(ref, {reason:'前台交互让出，空闲后自动继续'})`，不再 `pause()`；
- 恢复路径复用现有 `port.resume(...)` + checkpoint，`work.paused` 仅作为 IdleActivity 的内部“已让出”标记。

这样“调度让出”和“用户暂停”在检查点/审计上可区分，普通聊天不再把自主活动打成用户暂停。

## 2. 测试

`tests/activity-idle.test.ts` 新增：

- 运行中遇到前台压力时调用 `yield`，不调用 `pause`；
- reason 包含“自动继续”；
- 原有 round budget 测试保持。

全量 248/248。

## 3. 仍未完成

1. 执行器 job 创建时 `bindJob`（执行器调用仍可能未绑定 → interactive + 诊断）。
2. 片段级 RunLease：DSH 有 `agent/pre-step` / `step/end`，下一步验证工具执行期间让出安全性。
3. 反馈自动派发：复用 Activity/定时器，`due()` 先排除 unknown。
4. `ExecutionProducer.yield` 尚未接入管理端动作列表（只给 IdleActivity 使用）。
5. 普通任务的前台让出策略还未统一：目前只有 IdleActivity 主动调用 yield。

## 4. 变更

- `packages/core/src/execution-coordinator.ts`（yield 模式/checkpoint）
- `packages/activity/src/idle.ts`（pause → yield）
- `tests/activity-idle.test.ts`
