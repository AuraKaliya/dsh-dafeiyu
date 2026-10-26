# R6 装配决策：使用独立 ManagedHost 进程

2026-10-26。本记录取代 `server-execution-r6-plan.md` 早期“直接嵌入现有桌面 ctx”的主路径。保留 DSH 官方基础组件的用户约束不变；不修改、卸载或禁用它们来迁就新插件。采用既有 `ManagedHost`，运行于独立进程，继续使用官方 DSH AgentRegistry/AgentLoop/持久化/模型服务实现，并新增固定的 server-executor 装配枚举。管理员文件与命令能力经受信专用 CLI 子进程接入，不自动继承其它插件的全部工具。

## 已核实的装配限制

- `dsh-agent-loop` 0.2.1-rc.2 通过自身 runtime ctx 创建实际 Agent scope；调用方仅隔离 attachments/compaction，并不能改变所借用父 factory 创建的 Agent。真实组件的离线探针已证实这一点。
- 同一全局 Prompt 中创建第二个官方 AgentLoop 会重复注册 provider/model 变量；真实组件探针已验证拒绝，父 Agent 在失败后仍可运行。
- 改为独立 Registry/Loop/Prompt 后，仍要额外处理 tools 的 Prompt 投影和服务注入。试验中的产品 scope 未通过实际 Agent 运行验收，不能把构造成功写成可上线。
- 桌面 typert 注册表拒绝重复的 `agent` lookup/context。隔离 typert 只是让产品不进入父 UI 管理，不等于完成了桌面 UI 集成。
- 官方 BasicCompaction 的自动 pre-step/request-error 钩子捕获自己的 writer；未按实际 `agent.ctx` 选择 writer。服务隔离不能普遍排除这种父级全局监听器。其它图片卸载、工具结果落盘等钩子也需要逐个核验。这里是**机制与静态装配风险**，不是已经观察到线上记忆被修改：本机 dsh-web-app 默认 patch 禁用了若干根级压缩/裁剪/指令插件，首轮服务器清单也没有证明全部模块的实际启用状态。

没有找到满足本轮需求的公开 API，能够仅隔离这些跨 Agent 处理，又保持桌面基础功能原样。此次不通过私有 hooks、吞掉 next()、修改基础插件或替换父服务来绕开。独立进程使产品生命周期和来源压缩规则的边界明确，也最大限度复用已经校准的统一入口。

## 实际检查与处理

统一定向运行报告：`.runtime/test-reports/8559475e-4b16-4fb9-83ce-50506f058203.json`。50 项已报告结果为 43 通过、7 失败；另有 runner 最后一项挂起未完成，核实其没有存活子进程后终止了该**测试 worker**，因此整轮是失败检查，绝非发布验收。

装配试验中的失败分别是：一个只读 SQLite 全树断言受到新增 SHM/WAL 文件影响；独立 provider fixture 缺少必要服务；产品 Agent 的 Prompt 注入不完整导致 scope 与完整任务测试失败。基础 Host 原有 12 项全部通过。执行器 transport 的 10 项及唯一原预算账本适配的 4 项通过，runner 取消和退出问题另行修复并复测，不因架构切换而豁免。

不保留未通过的内嵌装配实现作为可启用产品入口。撤回的仅是本轮未提交的 provided-DSH Host 包装、scope/provider/runtime 试验和对应测试；保留上述结论、正式检查报告，以及已提交的 Core 命名外部授权、长期自主授权读取器、执行器账本和后续 IPC 工作。用户原有未提交 `docs/memory-phase-1.md` 不改动。

## 后续固定范围

1. ManagedHost 的配置、依赖检查、显式存储初始化/迁移、健康、恢复和排空接入固定 executor；不开放任意 import 或任意工具透传。
2. 独立父 Host 与专用 CLI child 共享本轮唯一验收费用和时钟；服务器生产运营授权以部署配置明确绑定。
3. 服务器桌面基础组件及其依赖保持；额外市场插件根据实际依赖清单清理。旧 QQ/Bili 的在途工作、私信接管、版本流程、真实新增记忆与账号分别核验。
4. 独立 SYSTEM update-guard 增加新进程的健康/空闲检查；普通插件更新仍走候选验证，不能覆盖守护本体或将运行数据纳入代码回滚。
