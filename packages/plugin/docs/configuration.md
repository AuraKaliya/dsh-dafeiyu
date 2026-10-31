# 必要与可选配置

所有路径相对于配置文件所在目录解析。配置文件和 `dataDir` 放在安装包之外，避免升级时丢失。

## 接到 DSH 桌面

首次部署、发布包结构和正确的组合补丁写法见 [安装指南](install.md)。先配置外部 settingsFile 和 Node 路径，再执行 check、init，并通过 DSH 安装器加载发布包。安装界面显示已加载不代表实例已就绪。

管理器会对可恢复故障进行有限重试；重复启动不视为故障。使用 status 核对 online、snapshot.phase 和 snapshot.services.qq；查询本身不发模型或平台请求。

## 本地部署后的 profile 检查

在源码工作区使用下面的检查入口。它默认只检查，不改文件；检查 `package.json` 的 BOM、JSON 语法，以及本地 `dsh-dafeiyu` 依赖声明、pnpm 锁与实际插件链接的一致性。

```powershell
node scripts/repair-dsh-profile.mjs --profile "$env:USERPROFILE/.dsh/profiles/desktop"
```

只修复 BOM 使用 `--repair`。需要把已安装插件链接和依赖锁对齐到 `package.json` 中已经声明的本地部署包时，先退出 DSH，再运行：

```powershell
node scripts/repair-dsh-profile.mjs --profile "$env:USERPROFILE/.dsh/profiles/desktop" --repair --align-plugin
```

修复会备份原文件及旧链接信息，BOM 修复保留其余 JSON 字节；目标包必须存在且声明为 `dsh-dafeiyu`。它不下载依赖、不迁移数据库，也不代表目标功能已验收。发现普通目录而非插件链接时会拒绝替换，避免删除目录内容。后续重新检查应返回 `ready: true`。

不要用 Windows PowerShell 5.1 的 `Set-Content -Encoding UTF8` 写 profile JSON，它会添加 BOM。必须通过结构化 JSON 修改并输出 UTF-8 无 BOM；本工具会拒绝修复其他语法错误，不猜测或改写配置字段。

## 实例配置

| 配置 | 必填 | 用途 |
|---|---|---|
| `dataDir` | 是 | 当前实例独立的数据目录，初次必须为空 |
| `model.model` | 是 | 已授权API或DSH账号可用的DeepSeek模型名 |
| `model.auth` | 否 | 默认api-key；dsh-account使用官方DSH账号提供器与已有登录 |
| `model.credentialStore` | 是 | DSH版本1凭据文件；按auth使用DEEPSEEK_API_KEY或本机已有官方账号登录 |
| `model.reasoningEffort` | 否 | 该模型支持的推理档位 |
| `model.baseURL` | 否 | 默认为官方API；自定义时须是HTTPS或本机回环HTTP |
| `qq.botId` / `qq.ownerId` | 是 | 机器人QQ / 主人QQ，必须主动配置且不同 |
| `qq.tokenFile` | 是 | OneBot令牌文件，至少32字符 |
| `qq.httpURL` / `qq.wsURL` | 是 | 本机OneBot回环地址 |
| `qq.groupIds` / `qq.joinedGroups` | 否 | 指定群 / 开放实际加入的群，默认不开放群 |
| `qq.messageBatch` | 否 | 默认enabled:true、quietMs:5000、maxWaitMs:15000、maxMessages:10；同会话同发送者合并 |
| `qq.stickers` | 否 | 默认关闭；enabled:true启用本地表情，默认512MiB/1000项，依赖媒体配置 |
| `qq.replyDelay` | 否 | 普通安装默认true；生成后按文本量延迟2—10秒，非文本不增加时间 |
| `foundationFile` | 否 | 自选底色文件；默认使用随包提供的通用大肥鱼底色 |
| `dshTools` | 否 | 默认false；true通过DSH桌面的cordis组合和官方工具管线执行主人任务、有效计划唤醒，使用danger-full-access权限，不另配命令模板；无桌面端口的独立CLI拒绝启动 |
| `activity.enabled` | 否 | 默认启用调度能力，计划由核心决定 |

启用媒体时，`media` 接受公共媒体接口配置：`ffmpeg`、`ffprobe` 必填；视觉使用 `vision: {provider,model,reasoningEffort?}`，provider与聊天路由一致。视觉还需配置 `model.inlineTransport: {contextWindow,maxOutputTokens}` 和模型支持的 `reasoningEffort`，上下文/输出上限按所用模型填写。音频语音识别使用 `audio.whisper`（node、moduleDirectory、moduleVersion为1.1.3、model），声音理解使用 `audio.events`（python、model、labels、onnxruntimeVersion、numpyVersion）；模型与标签对象为 `{path,sha256}`。准确字段以 `source/packages/media/src/audio.ts` 导出的配置schema为准；使用时会校验文件及哈希。

QQ附件的本机目录和HTTPS来源分别在 `qq.media.cacheRoots`、`httpsHosts` 主动配置；默认不读取任意目录或地址。发送媒体需 `qq.media.sendEnabled: true`，语音任务触发需 `voiceDirectives: true`。语义检索和其它高级Host接线可使用 `runtime/host/bin/dafeiyu-host.mjs` 配合已有Host配置。后续给已有实例增加新的存储模块时，按Host迁移流程先备份并升级，不能用重新初始化代替。

本地表情收录需配置视觉模型并实际读图，发送既有库内表情仍需FFmpeg/FFprobe及媒体模块；只启用 `qq.stickers.enabled` 不需要打开 `qq.media.sendEnabled`。后者用于一般媒体输出。表情原文件在实例QQ数据目录的 `stickers/objects/`，元数据在 `qq.sqlite`，不会被临时媒体缓存清理。纯表情按0文字量使用原发送延迟。QQ库升级到8需要先停用并使用Host迁移流程备份升级，不重建身份或记忆。

主人在真实QQ私聊发送 `表情管理：列表`（可附名称关键词）查看所有来源会话的条目；`表情管理：通用 名称或ID`、`停用`、`启用`、`删除`管理指定条目；`表情管理：改名 名称或ID => 新名称` 和 `表情管理：标签 名称或ID => 标签1,标签2`修改记录。同名时使用实际ID。自动收藏默认仅来源会话，提升通用和删除需要主人的明确命令；无需逐张确认普通收录与使用。

原版SnowLuma的 `get_record(out_format: wav)` 返回原始地址及转换后的base64，本插件优先使用转换后的WAV。音频后端分别受Windows Job内存上限约束；`audio.whisper.memoryBytes`、`audio.events.memoryBytes` 默认512MiB，可配置128MiB—2GiB。本机实际Whisper及YAMNet使用1GiB上限验证通过，不应把仅配置路径视为已完成后端验收。

QQ历史工具 `qq_browse` 首轮使用 `includeRecentHistory:true` 按需补取观察前24小时内的记录；分页使用 `cursor`，不重复补取。不覆盖已有文字或复活撤回消息，只能用已核验平台记录补齐缺失时间与转发定位信息。`qq_forward_read` 读取实际收到的合并转发，`qq_reply_quote` 选择本轮观察到的历史引用；选择不会立即发送，交付仍通过核心人格、原QQ来源及群助手核验。当前会话授权边界保持不变。

启用B站公开能力时配置：

```json
{"bilibili":{"capabilities":true}}
```

同时配置 `media`。公开读取可不登录；需要登录时参见 [B站登录与读取](bilibili.md)，配置 `bilibili.session: {file,expectedUid}`。私信配置为 `bilibili.channel: {accountUid,ownerUid,sessionFile}`，账号值没有默认值；公开能力与私信同时使用登录态时，预期账号必须一致。私信生产连接当前支持Windows。

公开读取和私信共用一个B站插件；每种接口按实际来源与已配置权限工作。频道账号变更、实例目录冲突、缺失必要库或未知库版本都会停止启动并报告原因，不自动清空或迁移。

## 依赖隔离与启动

DSH内的组合包使用隔离依赖布局，避免插件SDK在profile顶层形成第二套注册作用域。Windows可将虚拟依赖目录放在该机器的短路径中，数据目录继续独立保留。使用DSH自带pnpm，并先备份当前profile配置与实例数据。pnpm 11的项目布局设置写入当前profile的 `pnpm-workspace.yaml`，不要放入 `.npmrc`；参见[pnpm官方配置说明](https://pnpm.io/cli/config)。

```yaml
nodeLinker: isolated
hoist: false
shamefullyHoist: false
autoInstallPeers: false
virtualStoreDirMaxLength: 45
ignoreWorkspaceRootCheck: true
```

`virtualStoreDir` 可另设为该机器上的独立短路径；后续更新沿用相同目录。仅改变依赖安装布局，不移动或重新初始化 `dataDir`。入口等待DSH应用就绪后才加载运行模块与创建独立进程；启动故障只记录阶段、异常类型、标准错误码和有限模块元数据。插件入口已加载不代表独立实例已就绪，应检查实际状态。
