# R6 B站主人渠道：Host runtime 接线审计

2026-10-27。AI 独立只读审查。范围为 Host configuration/runtime/status、`host-bili-owner-runtime*.ts`，并沿 Core/Journal 与 BiliOwner 公共生命周期核对调用。本审阅代理未修改业务或测试源码，未构建、执行测试、调用模型/平台或连接服务器；存储装配文件保持冻结。根代理随后执行的实际定向结果另列于文末。

## 结论

发现 3 个具体问题，均直接反馈根代理：optional factory/open 失败处理、暂时不可用导致旧 native Task 来源失效、bindingFault 状态字段不匹配。三项已改源，根代理的 Host runtime 定向组 7/7 通过。旧工作保护采用“有依赖工作时保守拒启，保持原 Run”，不是单 producer 暂停。组合 21 项仅 14 通过、7 失败，另 7 项仍由渠道实现代理修复，不能称为整体验收通过。

当前 descriptor 已明确是 `channel.bilibili-owner.v1`，没有沿用旧 simulator 映射。配置的 native 动作及资源白名单、正常验证/开放顺序、single-run 工厂跳过和状态可选字段设计总体符合已提交方案；不能将这些静态结论写成上线或真实 DM 验收。

## 初次静态截点

| 文件 | SHA256 |
| --- | --- |
| `packages/host/src/configuration.ts` | `035e09e8e077b5d1e2da84339809ddf59875c84dcddd495f2a3d9b89b376d50b` |
| `packages/host/src/runtime.ts` | `62fd74d41486f0e3df8eaf6b6b488829899f921ecf3328b1956e6d1d4c79124f` |
| `packages/host/src/status.ts` | `9f53c856b8a9f1e4ca7423f86959d4a681d429726485594813e5cb4c6d571516` |
| `tests/host-bili-owner-runtime.test.ts` | `2788cf1efccfcff093c8acedab227afaf2d3435e4bbb007f1346e4b362b3df3f` |
| `tests/host-bili-owner-runtime-fixture.ts` | `feff4e9833d0388a66e4b5b1173a5d791bd32b24f9e5014bc9c1df0903025f10` |

实现仍由根代理推进，之后的代码变化须与统一测试候选重新对应。

## 具体发现

### 1. optional factory/open 异常曾使整个 Host 失败（已修，Host factory 场景通过）

原装配分支只针对缺 factory 和后续 start/verify 异常判断 required；`await createBiliOwnerPorts()` 与 `await openBiliOwnerChannel()` 的异常直接逃到 Host.start 总失败路径。复现只需 required=false、factory 抛 BILI_OWNER_LEASE_REVOKED；原本应隔离的可选能力失败会停止整个 Host。

根代理现已用同一 optional catch 覆盖 factory/open，required 仍抛出，optional 清空实例并标记 degraded。同时为仍有其它活跃 producer 的共享 conversation policy 排除确实未装载的渠道动作，避免后续 HOST_POLICY_ACTION_UNAVAILABLE 二次失败；未把不存在的动作注册成可调用工具。

optional fixture 已验证新空 profile 的 factory 抛错后 simulator 对话仍可用、Bili Task工具不出现。它不替代第2项“已有 native 队列”回归，也不把渠道构造/身份异常的全部资源释放路径宣称通过；后者仍在渠道专项失败范围中。

### 2. 暂时不可用可把旧 Bili native Run 写成 failed（已修，Host 旧工作回归通过）

原缺陷路径：已持久 accepted/queued 的 Bili原生 Task → 重启时 optional transport.verify 仅因临时网络故障失败，pins/lease/持久账号绑定仍有效 → Host catch 关闭 channel、移除 message binding → 随后的 `core.activate(resume)` 激活所有 accepted/queued Task。

Core `ExecutionCoordinator.activate` 没按缺失渠道跳过这些 Run；执行 guard 的 validateMessageAncestors/validateMessageSource 因 binding 不存在抛 SOURCE_STALE，catch 对 queued/running 持久 failed。因此临时连接失败会被误记为原真实来源失效。若 optional factory 失败改为降级但未建立 binding，已有同类队列也会走该路径。

这与 B 包 sourceReady 的原则不一致：它基于持久 verifiedBinding/pins/lease 判断历史来源，瞬时在线 verified 仅控制新准入；真实账号/绑定变化则持久 fault。原 Host 在临时失败后 close 会抹去这层区分。

根代理选择保守拒启策略：没有渠道实例但存在旧待办时，在 Core 恢复前报 HOST_BILI_OWNER_PENDING_WORK_REQUIRES_CHANNEL；optional start/verify 失败且存在旧待办时，在 Core 全局 activate 释放前拒启并清理。检测覆盖该渠道未完对话、accepted/queued/running/cancelling Task 与未完 native delivery。它没有引入按 producer 暂停队列的机制，空 profile 仍按 optional 语义降级继续运行。

新增真实 Host 回归保存一个 accepted Task，分别模拟 factory 失败和临时 verify 失败；两次拒启均断言原 id/state/error 和模型调用数完全不变。恢复虚构端口的有效来源后，同一 Run 完成，没有创建替代 Run。这支持本次防止 SOURCE_STALE 误写的修复；真实账号/绑定 fault 仍应拒绝。

### 3. bindingFault 导致严格状态解析失败（已修，Host 状态读取通过）

B 当前 getStatus 总会返回 bindingFault（null 或稳定错误码），Host.snapshot 原样嵌入；原 `status.ts` 的 biliOwner strictObject 未声明该字段，故有实例的 publish → readHostStatus 会抛 HOST_STATUS_INVALID。chat/task/drain 场景原有状态读取断言可覆盖。

根代理已新增 optional nullable 稳定 code 字段，接受新状态且保留旧 snapshot 没有该键的解析兼容。没有以放宽整个状态对象来容纳私人正文或任意异常。

## 配置与权限边界核对

- BiliOwner 配置复用固定 account/owner literal；数据仍位于 core，未新增 paths.channels 或资源布局。新 descriptor 为独立 channel.bilibili-owner.v1。
- 启用渠道要求 Memory 与 sourceTracking/compaction；启用 Task 再要求 Bili、Media、message-task 和必要 native-expression/delivery 能力。
- 固定 native policy 必须只有 producer bili-owner-tasks，actions 同时要求所有固定项且拒绝额外项，externalActions 非空即拒绝。该名单为公开读取、Media观察、执行来源选择与任务异议/对象本地动作，没有平台发布、服务器执行或 QQ 管理动作。
- resources 必含 BILI_PUBLIC_SCENE，额外只接受固定 BILI_OWNER_SCENE；explorationResources 也由渠道 schema 限定公共场景。共享 conversation policy 可包含其它渠道工具，但执行来源检查仍由 Core binding 硬拒跨渠道使用。
- Model/HTTP transport 的程序端口不来自 JSON；Bili工厂仅 daemon 且配置启用时调用。single-run 不取得账户 lease、不实例化私信渠道，保留本地 pending。

## 生命周期与资源边界核对

正常路径是：模型与资金准入安装 → Core/Memory/execution → lazy Bili ports/channel（held）→ 渠道及 Core 恢复 → Core activate(deferWork) → channel.start/verify → Core release → releaseIngress。Core 对话与 native Task 的恢复调度、新DM入站在最后开放；恢复补的是持久状态与撤回事实，不靠重新模型执行补记。

sourceReady 已允许 recovered/active/quiescing 下的有效持久 binding；新 submit/control 另要求 active、非held、在线verified。因此排空可以继续核对旧来源，同时停止新Task准入。Host shutdown 先停 Activity/Core/渠道准入，等待 Core/发送/各服务，超时再取消，最后先关闭渠道再关闭 Core与父scope；已可能出网的发送仍由渠道保留 unknown/实际回执。

成功返回的 ports 所有权移交 BiliOwnerChannel；其 static open 失败路径负责 close/release，正常 close 负责自身 fiber 与 ports，不关闭父 Context。factory 在返回前失败时，未返回的部分资源仍属于 factory，必须由受信创建器清理；Host无法释放它没有得到的 lease。当前 optional fixture 是取得 ports 前抛错，构造失败后的 exactly-once 释放还需结合渠道专项结果。

## 状态兼容与测试范围

services.biliOwner 与 schemas.biliOwner 都是可选字段，旧 snapshot 不回填；bindingFault 同样 optional。状态只带固定UID、阶段、计数、回执未知数、backoff和稳定code，没有正文、token或旧私信内容。readHostStatus 仍核对配置hash、时间新鲜度和Host占用，不把某个离线JSON当作在线证明。

初审的 6 项 runtime fixture 为 chat/restart、真实公共能力 Task＋目标人格交付、required缺ports、optional factory失败＋共享policy、single-run保留队列、drain后重启只发送不重跑原模型；后续增加第7项旧待办在 optional 失败时保留并恢复同 Run。真实部分是 Host/Core/Memory/官方DSH与产品渠道；模型与Bili网络均为虚构端口，输出明确 realModel=false、realPlatform=false、serverAccess=false。

## 后续实际定向结果

报告：`.runtime/test-reports/70d0873d-f03d-4406-af63-743c8d59ec7d.json`。运行时间为北京时间 2026-10-27 00:12:16 至 00:12:43；build、test-types、tooling-types 均 exit 0。

- Host runtime 本组 7/7 通过，包括新旧工作保护、空 profile optional 降级及状态读取。
- 整个组合为 21 项、14 通过、7 失败，零 cancelled/skipped。7 个失败全部列于 `bili-owner-channel.test.js`，涉及任务/兴趣/跨渠道、quiesce、来源恢复、账号变化及失败资源释放，由渠道实现代理继续修复；本记录不宣称这些已过。
- 报告明确 realModel=false、realPlatform=false、serverAccess=false；这是官方 DSH 与真实程序装配的离线回归，不是实际 Bili 入站/发送或生产预算验收。
- 失败现场按受管策略保留，当前 run 记录 32111897 字节，cleanup.blocked=[]。本审阅代理未自行测试、删除现场或修改代码。
