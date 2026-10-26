# R6c-1 检查记录：执行器持久状态机

2026-10-26。依据已提交 R6 方案（`7b7725b`）分子步实施。本检查点只完成 `packages/server-executor` 的持久化骨架与严格数据契约；尚未接入 IPC、child runner、Core actions、bootstrap 或实际模型预算端口。

## 实现范围

新增 package.json、tsconfig.json、`src/types.ts`、`src/store.ts`、`src/index.ts`，以及 `tests/server-executor-store.test.ts`。根 workspace／lock／tsconfig 由主代理接线；主代理报告 offline 安装仅增加一个 workspace link，本支线未运行安装、构建、测试或 Git 提交。

executor.sqlite 使用独立 application ID `0x44465831`、schema v1、事务和完整同步写入。普通打开遇到缺库会拒绝，只有显式 create 可以初始化空的新库；身份或版本不符拒绝。没有修改 memory／Core 的表或恢复旧数据。

持久记录包括 job、operation 绑定、追加事件、每 job 一份不可变终态回执，以及供下一子步使用的父预算回执关联表。job 稳定指纹绑定原 Task scope／epoch／request、authorizationKey、goal/input/profile/command/executable hash；每个实际 operation 另存 runId／operationId 和完整授权描述 hash。它们是审计数据，不是可转移的 Core grant，后续 service 仍必须持有真实 `authorizeExternalTask` 结果并执行 guard。

当前状态路径为 prepared→launching→running→completed／failed／cancelled／unknown。关键约束：

- 同 requestId、scope、epoch 与同指纹回到原 job；改变输入会冲突。同 operation 不能被重新绑定到另一 job，不因重试再生成一次执行。
- spawn 前必须先唯一领取并持久记录 launching；重复领取、旧版本、重复 nonce 均拒绝。当前代码没有 spawn。
- running 握手绑定已保存的 nonce hash、profile hash、可执行文件 hash、PID 和进程创建身份。当前持久过程字段必须与不可变握手事件一致；不能仅篡改 head 中的 PID/创建身份。
- 回执与事件不可变。完成要求经过核验的零退出、child session 和已封存可见输出引用；取消不抹去已有 confirmed effects。unknown effects 必须保留为 unknown job，不能用 cancelled/failed + effects:none 改写。
- 恢复不自动启动或重新附加权限。prepared 可证明未派发，封存为 failed/effects:none；launching/running 的中断窗口封存为 unknown。再次恢复不重放，也不自动把 unknown 改为已知结果。
- 同一 executor profile 存在 prepared／launching／running／unknown 时，不能通过更换 requestId、Task 或 profileHash 自动再派发。此为执行并发与未决副作用保护，不是每轮模型调用次数上限。
- 输出路径、事件、回执使用严格 Schema，拒绝未知 owner、thinking、stderr 等附加字段及路径穿越。此子步没有接受原始 stdout/stderr 的接口。

`executor_budget_links` 只保存未来父回执的 job/call/reservation 关联及状态，尚无写入方法；它没有余额、价格、授权额度或费用计算字段，不是子预算权威账本。原 7C 总账、授权和时钟未改。

## 实际定向检查

主代理统一受管报告：`.runtime/test-reports/05f3721b-bede-4127-af2e-ae7a11894884.json`。

- build、test-types、tooling-types 和 tests 四阶段均成功。
- 同批总计 **43/43 通过**：本 store 专项 8 项，R6a 专项 12 项及其它原执行相关检查；这是定向范围，不是全仓库回归。
- 本 store 的 8 项分别覆盖：显式初始化／身份／版本；请求与 operation 幂等／冲突／scope；唯一 launch claim 与握手；不可变回执及历史；取消效果保留；关闭／重开后的保守恢复；PID 创建身份与 nonce 复用拒绝；严格 Schema、路径与私有载荷拒绝。
- 专项使用真实本地 SQLite 事务、关闭／重开和两个连接的版本竞争；其中 process／session／结果引用均为明确虚构的单元样本，没有启动进程。

报告明确 `realModel:false`、`realPlatform:false`、`serverAccess:false`。未产生付费模型调用，未连接服务器，也未把合成 PID／创建时间当作服务器身份验证。

受管清理成功：本次运行目录 `05f3721b-bede-4127-af2e-ae7a11894884` 已移除，`cleanup.blocked=[]`。既有三个失败保留目录仍按原规则保留，没有为了本次通过删除历史失败证据。

## 尚未完成的边界

本记录不能证明真实 child 的 SID／提升状态／创建时间、进程树取消或 DSH headless 工具效果。PID 数据目前只验证持久一致性；下一步须由固定受信进程验证器提供真实事实，不能让 child 自述或环境变量授予管理员资格。

本记录也不能证明费用覆盖、IPC 许可或结果回报链：还没有 BudgetPort 适配、逐调用预留／usage、child 中断对账、stdout 白名单解析、实际结果归档读取或 QQ 交付。没有注册 external-write 动作，不会把当前包解释为已启用执行能力。

下一检查点优先实现现有 Node spawn IPC 通道、严格协议和无模型的真实 Node fixture；再接父预算 Port／child llm-stream middleware。按实装 DSH 0.2.1-rc.2 解析专用 profile，不新开命名 pipe 服务，不改官方基础软件，不携带真实 key。Core actions 待 R6a 稳定后通过其公开接口接线，effects 必须准确为 external-write，不直发 QQ。

本支线在该检查点保持源码／测试停写，等待主代理提交后再进入下一子步。原 `docs/memory-phase-1.md` 的用户修改未动。
