# 大肥鱼 · dsh-dafeiyu 0.28.13

基于 DeepSeek Harness 的可成长智能体，整合记忆、QQ、B站、媒体、持续任务和自主活动。管理入口位于 DSH 设置中的“大肥鱼管理中心”。

本版为第 4 轮本地候选；程序回归、隔离新装与迁移回退证据单独保存。真实语义、费用及同进程两小时观察尚未执行，不能据本地候选认定正式发布验收通过。

## 安装

请阅读[全新 DSH 安装指南](docs/install.md)。发布包包含预编译代码，安装无需 TypeScript 编译；源码工作区需要先构建发布包，不能把源码根目录或未构建插件目录交给安装器。

要求 Windows、Node.js 24.13+（24.x），已验证 DSH SDK 0.2.1-rc.2 / Desktop 2.0.18。准备模型凭据、不同的机器人/主人 QQ、OneBot 地址与令牌。配置、数据和凭据放在安装包之外。

顺序：独立安装依赖 → 填写 examples/dafeiyu.config.json → CLI check → CLI init → DSH 安装本地发布目录 → 核对就绪状态。新装直接使用当前版本，不先安装历史中间版本。

## 能力与运行

- QQ 支持私聊、群聊、自然称呼、消息合并、历史回看、引用、表情、任务和媒体。群助手功能需要 OneBot 实现提供对应接口，缺少时明确报告。
- B站支持关键词搜索、视频资料、短游标评论、字幕、弹幕和批量帧；本地 Cookie 经 UID 校验后用于 HTTP。登录有效与接口可读分别显示。
- 媒体使用安装者配置的 FFmpeg、视觉和音频后端；实际处理范围与缺口保留在结果中。
- 任务持久承接原请求与后续修订，统一使用最高一百万 token 的共享窗口；平台容量不足时保留工作并接续。累计消耗与单次上下文分别计量。
- 自主活动按配置启用。dshTools:true 使已授权主人任务使用 DSH 工具，必须由桌面管理器启动。

自动启动和按钮共用一个控制器。重复启动不增加进程，停止可以取消启动等待。管理中心显示阶段、真实进程及历史错误；B站受限不把整个实例误标为启动失败。

## CLI

~~~powershell
node bin/dafeiyu.mjs check --settings <配置文件绝对路径>
node bin/dafeiyu.mjs init --settings <配置文件绝对路径>
node bin/dafeiyu.mjs status --settings <配置文件绝对路径>
~~~

旧数据用 migrate 显式升级，先停止并备份。当前 API 10、B站库 v6、运行库 v7、QQ 库 v8、Activity/Media 库 v4。独立 start 仅适用于 dshTools:false，已启用桌面桥的实例使用管理中心启动。

## 文档

- [安装与回退](docs/install.md)
- [配置](docs/configuration.md)
- [管理中心](docs/management-center.md)
- [B站登录与阅读](docs/bilibili.md)
- [当前契约](docs/current-contract.md)
- [架构](docs/architecture.md)
- [验证范围](docs/validation.md)
- [本地候选与封存](docs/local-candidate.md)
- [更新说明](docs/release-notes.md)

真实模型、账号和平台行为须单独验收。发布包不应包含个人账号、Cookie、密钥、聊天或记忆。
