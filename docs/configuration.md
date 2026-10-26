# 必要与可选配置

所有路径相对于配置文件所在目录解析。配置文件和 `dataDir` 放在安装包之外，避免升级时丢失。

| 配置 | 必填 | 用途 |
|---|---|---|
| `dataDir` | 是 | 当前实例独立的数据目录，初次必须为空 |
| `model.model` | 是 | 已授权API账号可用的DeepSeek模型名 |
| `model.credentialStore` | 是 | DSH版本1凭据文件，其中包含DEEPSEEK_API_KEY条目 |
| `model.reasoningEffort` | 否 | 该模型支持的推理档位 |
| `model.baseURL` | 否 | 默认为官方API；自定义时须是HTTPS或本机回环HTTP |
| `qq.botId` / `qq.ownerId` | 是 | 机器人QQ / 主人QQ，必须主动配置且不同 |
| `qq.tokenFile` | 是 | OneBot令牌文件，至少32字符 |
| `qq.httpURL` / `qq.wsURL` | 是 | 本机OneBot回环地址 |
| `qq.groupIds` / `qq.joinedGroups` | 否 | 指定群 / 开放实际加入的群，默认不开放群 |
| `foundationFile` | 否 | 自选底色文件；默认使用随包提供的通用大肥鱼底色 |
| `activity.enabled` | 否 | 默认启用调度能力，计划由核心决定 |

启用媒体时，`media` 接受公共媒体接口配置：`ffmpeg`、`ffprobe` 必填；视觉使用 `vision: {provider,model,reasoningEffort?}`，provider与聊天路由一致。视觉还需配置 `model.inlineTransport: {contextWindow,maxOutputTokens}` 和模型支持的 `reasoningEffort`，上下文/输出上限按所用模型填写。音频语音识别使用 `audio.whisper`（node、moduleDirectory、moduleVersion为1.1.3、model），声音理解使用 `audio.events`（python、model、labels、onnxruntimeVersion、numpyVersion）；模型与标签对象为 `{path,sha256}`。准确字段以 `source/packages/media/src/audio.ts` 导出的配置schema为准；使用时会校验文件及哈希。

QQ附件的本机目录和HTTPS来源分别在 `qq.media.cacheRoots`、`httpsHosts` 主动配置；默认不读取任意目录或地址。发送媒体需 `qq.media.sendEnabled: true`，语音任务触发需 `voiceDirectives: true`。语义检索和其它高级Host接线可使用 `runtime/host/bin/dafeiyu-host.mjs` 配合已有Host配置。后续给已有实例增加新的存储模块时，按Host迁移流程先备份并升级，不能用重新初始化代替。

启用B站公开能力时配置：

```json
{"bilibili":{"capabilities":true}}
```

同时配置 `media`。公开读取可不登录；需要登录时配置 `bilibili.session: {file,expectedUid}`。私信配置为 `bilibili.channel: {accountUid,ownerUid,sessionFile}`，账号值没有默认值；公开能力与私信同时使用登录态时，预期账号必须一致。私信生产连接当前支持Windows。

公开读取和私信共用一个B站插件；每种接口按实际来源与已配置权限工作。频道账号变更、实例目录冲突、缺失必要库或未知库版本都会停止启动并报告原因，不自动清空或迁移。
