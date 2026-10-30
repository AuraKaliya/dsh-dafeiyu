# 注意力层第六版：执行器 job 绑定 WorkCallContext

日期：2026-10-30
基线：`9f9b9e1`
范围：Batch 2a 遗留——执行器 job 创建时绑定真实工作身份。
验证：`npm test` 248/248 通过（55 个单元测试文件）。

## 1. 绑定

`server-executor` 在创建 job 时：

```ts
workContexts.bindJob(job.id, {
  workItemId: `task:${authorization.taskId}`,
  runId: authorization.runId,
  scopeKey: authorization.scope.scopeKey,
  class: authorization.motivation.kind === 'self-exploration' ? 'background' : 'owner-task',
  targetVersion: authorization.intentVersion,
  stage: 'executor',
});
```

- 绑定发生在 spawn 之前，子进程的模型调用请求带 `owner.jobId` 时，父进程 `SharedModelBudget.leaseFor` 能解析到真实 class/workItemId/runId。
- `active` 记录保留 `unbind`；job 结束、取消、主机停止时解绑，避免 jobId 复用/泄漏。
- `cancelRunning` 先解绑再 abort。
- 子进程传入的字段仍只作为查找键，不能提供 class。

## 2. 验证

- 全量 248/248（服务代码通过类型检查与现有测试）。
- `workContexts.bindJob/resolveJob/unbind` 已有 `tests/work-context.test.ts` 覆盖。
- 本轮没有新增服务级集成测试；执行器启动/真实模型仍属后续验收。

## 3. 仍未完成

1. 片段级 RunLease：DSH `agent/pre-step` / `step/end` 的让出可行性。
2. 反馈自动派发：复用 Activity/定时器，`due()` 先排除 unknown。
3. `ExecutionProducer.yield` 接入管理端动作列表；普通任务的主动让出策略。
4. 执行器 job 的 class 仍由 motivation 推导；如需要更细的 interactive/owner-task 区分，需把 WorkCallContext 传入执行器授权，而不是在服务端猜。

## 4. 变更

- `packages/server-executor/src/service.ts`
- 本记录
