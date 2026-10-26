# R6c/d：受控子进程、费用 IPC 与原账本接入

2026-10-26。已交付固定 Node 程序启动、双向 IPC、逐调用预算准入、全 child DSH 模型中间件、输出白名单及原 EvaluationLedger 适配。此检查点没有启用真实 DSH CLI、真实模型、平台或服务器执行。

## 行为

父端核对 Node/入口/profile 指纹和绝对工作目录后启动，不经过 shell，环境只来自固定白名单。子端先发 profile 身份；父端验证真实进程接口并持久确认 ready 后才开放 stdin 和调用许可。调用前检查当前任务 guard、路由、输出上界、时限及父费用预留；摘要和标题等辅助 session 也走同一 DSH `llm/stream` 中间件。没有每轮调用次数上限。

结算收到原账本的明确结果后才能继续。无 usage、中断、费用超出预留、断链或结算确认失败均保持 unknown，并阻止新请求。取消任务不能取消已经发生的费用。子端不创建第二个预算、验收 attempt、lease 或时钟；`evaluationExecutorBudget` 使用协调者提供的当前 attempt 与原账本，保留原 firstCallAt/expiresAt 和累计时间。

结果白名单只保留 session、有限进程/工具元信息和脱敏的 final 自述；thinking、工具原始参数/结果、普通 text 流及 stderr 正文不保存。退出码 0 不被解释为全部业务目标已经完成。stdout 只供结果核对，费用来自受信调用钩子。

退出与流排空分别记录：真实 `exit`/该 ChildProcess 的退出状态提供进程终态，`close` 只表示流排空。取消收尾、证明等待和夹具清理有界；终止前核对原 PID 创建身份和程序身份，身份不一致不发终止。无法确认退出或输出完整性保留缺口，不把取消当成回滚。

## 定向检查

- transport 10/10：严格协议、真实 Cordis/DSH 中间件的 40 次脚本调用（含辅助 session）、准入拒绝、缺用量、超上界、幂等/冲突、撤销、断链、握手时序及输出过滤。
- 原账本适配 4/4：父/child 费用合计、原时钟保持、绑定/路由拒绝、重复结算、取消后仍结算、unknown 与超上界、停止时钟不能由新 child 重新启动。
- 实际 Node child runner 7/7：握手后才输入和派发、固定程序/环境核对、错误profile、崩溃、无usage、撤销、进程身份变化拒绝终止。实际写入仅受管 D 盘虚构文件，模型为脚本 adapter；**OS 创建时间和管理员身份端口仍是模拟的**。

前 14 项的报告为 `.runtime/test-reports/8559475e-4b16-4fb9-83ce-50506f058203.json` 中对应文件的通过结果；该混合运行整体失败，不能写成全量通过。初版 runner 的撤销退出断言失败，最后一个夹具挂起；核实没有剩余子进程后终止唯一测试 worker，原失败保留。修复后仅复测 `npm test -- build-tests/server-executor-runner.test.js`，7/7 通过，报告 `.runtime/test-reports/ee3f1bdf-212f-44e6-bbb7-d71f7b8c18eb.json`，成功临时目录已清理，清理阻断为空。

共 21 项相关检查分别取得通过证据，不代表全量回归或真实模型/管理员/平台验收。后续仍需真实 Windows token/创建时间、实际 DSH headless profile 接线、Core V3 service、目标绑定的人格交付，以及 ManagedHost 与服务器 guard 联合检查。
