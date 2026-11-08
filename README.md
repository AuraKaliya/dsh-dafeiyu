# 大肥鱼 · dsh-dafeiyu

**0.28.15（群发表情与媒体衔接修复版）** · Windows · Node.js 24.13+（24.x）· DSH SDK 0.2.1-rc.2

0.28.15 新增主人指令绑定的单次群发表情，保留真实群目标与发送回执；修复交付时丢失表情身份和阻断原因，以及多图理解后重复识图才能收录的问题。同步改进参数提示与核验推理档位选择。API更新为11，自有模块随包统一升级，数据库结构保持。本轮不自动切换正在运行的DSH实例。

本轮608项全量回归与3项冒烟通过，修复范围、独立包检查与实机复验边界见[第二轮实机反馈修复记录](docs/results/feedback-fixes-0.28.15-20261108.md)。

0.28.15已于11月8日23:48完成本机部署，等待用户自行重启。部署使用修正旧配置初始化兼容问题、重新通过608项回归和3项冒烟的r2包，见[本机部署记录](docs/results/local-deploy-0.28.15-20261108.md)。

0.28.14 针对本机人工实测修复主动历史回看、合并转发分页与媒体来源、重复错误参数、忙碌时连续消息合并以及短回复拆分。API 10 与现有数据库结构保持；百万上下文容量保持。本轮源码与离线回归不等于当前 DSH 已升级或真实模型复验通过。

上一轮0.28.14的600项全量程序回归、3项冒烟通过，具体修复、发布包检查及未覆盖范围见[实机反馈修复记录](docs/results/feedback-fixes-0.28.14-20261108.md)。

0.28.14 已于11月8日22:20完成本机独立部署、备份及静态核验，等待用户自行重启DSH后继续人工测试，见[本机部署记录](docs/results/local-deploy-0.28.14-20261108.md)。当前不将待启动状态写成新版本已在线。

此前 0.28.13 已完成第 4 轮本地候选整合与封存，并完成本机独立包配置与迁移，见[本机部署记录](docs/results/local-deploy-0.28.13-20261108.md)。用户随后自行启动并进行人工对话测试。原封存与离线结果保持原结论，不沿用其验收结论为 0.28.14 背书。

579 项程序回归、3 项冒烟、27 个独立离线场景及独立包初始化通过，见[第 3 轮本地结果](docs/results/phase3-local-20261108.md)。真实模型语义校准仍未执行。

0.28.11 已完成第 2 轮重任务热点修复、取消响应及进程恢复验证，见[性能与恢复契约](docs/plans/phase2-performance-contract-20261108.md)。

第 2 轮剩余本地工作已完成：563 项全量、3 项冒烟、16 个离线业务场景及独立性能审计通过，见[性能与恢复结果](docs/results/phase2-performance-local-20261108.md)。

前批 0.28.10 已完成确定性正文折叠、批量回查、文本分页索引和输入测量，见[第 2 轮上下文契约](docs/plans/phase2-context-contract-20261108.md)。

555 项程序回归、16 个离线场景、独立包初始化及 v6→v7 迁移验证通过；固定同覆盖样本输入减少约 35.7%，详见[第 2 轮本地结果](docs/results/phase2-context-local-20261108.md)。该比例不是实际费用节省比例。

0.28.9 的统一目标/执行/交付视图、无需模型的故障通知和文字/媒体续发已完成，历史结果见[第 1 轮本地验收](docs/results/phase1-local-20261108.md)。真实模型局部复验仍未完成。

前批 0.28.8 的生成/核验恢复结果见[交付恢复验证](docs/results/delivery-recovery-20261107.md)。过期授权不自动续期，真实局部复验与完整修正版验收仍按总计划推进。

0.28.7 的历史功能场景和同进程两小时结果见[既有验收记录](docs/results/local-acceptance-20261107.md)；这些结果不计为当前版本的真实模型或连续运行验收。

长任务成本治理及完整验收驱动纳入版本管理仍有待完成，原因和后续顺序见[多轮迭代复盘](docs/results/iteration-review-20261107.md)。既定场景通过不能替代日常成本和持续业务可用性的证明。

运行在 DeepSeek Harness 上的可成长智能体，整合 QQ、B站、媒体、持续任务、长期记忆和自主活动。程序管理身份、来源、权限、预算与交付；模型选择方法、理解材料并表达结果。

**首次部署从[全新 DSH 安装指南](packages/plugin/docs/install.md)开始。** 本目录是源码工作区，不能直接作为 DSH 插件安装；先构建发布包。已有发布包可以跳过编译。

## 当前能力

| 模块 | 能力 |
|---|---|
| 管理中心 | 自动/手动启动共用控制器，操作进度、取消、重试、状态核对与模块配置 |
| QQ | OneBot 私聊/群聊、多消息回复与实际发送计数、消息合并、历史回看、引用、表情、任务与媒体 |
| B站 | 关键词搜索、视频资料、评论游标、字幕、弹幕、批量帧；本地 Cookie 验证与读取诊断 |
| 媒体 | FFmpeg、多图理解、语音识别、声音事件、文档和可选语音输出 |
| 任务 | 完整任务意图承接、百万上下文、持久工作记录、检查点接续与最终交付 |
| DSH 工具 | 分页目录、按名称查看参数和技能、版本核对、阅读阶段只读调用与授权任务执行 |
| 记忆与成长 | 经历、反思、自我认识、阶段人格、表达偏好与关系 |
| 自主活动 | 计划唤醒、空闲探索、整理与休息，按配置启用 |

一个实例绑定一个机器人 QQ 和一个主人 QQ。模型、OneBot 登录、FFmpeg 与媒体模型由安装者准备；B站不提供公开评论或弹幕发布。真实平台验收与离线测试分别记录。

## 构建与验证

~~~powershell
npm ci
npm run build
npm test
npm run test:smoke
node scripts/build-public-release.mjs .runtime/releases/current
node scripts/check-public-release.mjs .runtime/releases/current
~~~

发布输出目录必须是新的。发布包包含预编译运行代码、管理客户端、CLI、公开示例、当前文档和版本清单。数据、配置、凭据与工作区依赖不进入发布包。

部署目录独立安装依赖，运行 CLI 的 check、init，再交给 DSH 安装器。**不要把指向工作区的依赖链接当作新装验收。** 可先只启用基础 QQ，连接正常后再启用 B站、媒体、DSH 工具和自主活动。

## 当前文档

- [安装、初始化、升级与回退](packages/plugin/docs/install.md)
- [配置](packages/plugin/docs/configuration.md)
- [管理中心](packages/plugin/docs/management-center.md)
- [B站登录与读取](packages/plugin/docs/bilibili.md)
- [架构](packages/plugin/docs/architecture.md)与[当前接口](packages/plugin/docs/current-contract.md)
- [验证范围](packages/plugin/docs/validation.md)与[更新说明](packages/plugin/docs/release-notes.md)
- [基础配置示例](packages/plugin/examples/dafeiyu.config.json)

profiles/ 是高级 Host 装配示例，不能直接填入安装器的 settingsFile。docs/checks/、docs/results/ 和 reports/ 是历史证据，其中的旧版本、机器路径和维护窗口不是当前安装步骤。

## 源码目录

packages/plugin 提供安装和管理界面；host 负责装配；core 负责对话、任务、来源和交付；memory 管理记忆与成长；channel-qq、bilibili、media、activity 提供对应能力；contracts 统一协议；journal、timeline 保存事件与来源；server-* 提供可选服务器执行支持。

MIT。提交日志前移除凭据、聊天内容和不必要的本机路径。
