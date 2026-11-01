# 大肥鱼 · dsh-dafeiyu

**0.27.0** · Windows · Node.js 24.13+（24.x）· DSH SDK 0.2.1-rc.2

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
