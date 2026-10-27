# 必要与可选配置

所有路径相对于配置文件所在目录解析。配置文件和 `dataDir` 放在安装包之外，避免升级时丢失。

## 接到DSH桌面

当前版本没有图形初始化表单，安装和启用插件本身不代表已配置成功。先退出DSH，再在当前profile的 `cordis.patch.yml` 序列末尾加入以下一项；已有同ID项时修改原项，不重复添加。默认桌面profile位于 `~/.dsh/profiles/desktop/`。

```yaml
- id: dsh-dafeiyu
  name: dsh-dafeiyu
  config:
    settingsFile: 'D:/your-config/dafeiyu.config.json'
    nodePath: 'D:/your-node/node.exe'
```

路径必须换成自己的配置文件和Node.js 24.13+。启动顺序为本机OneBot与QQ登录、DSH、启用大肥鱼。插件入口显示“运行中”不能证明QQ连接成功；使用 `node bin/dafeiyu.mjs status --settings <配置文件绝对路径>` 查看 `online`、`snapshot.phase` 和 `snapshot.services.qq`。`check`只检查配置及文件；`status`不发模型请求或平台消息。当前入口不会在依赖失败退出后自动重启，恢复依赖后需停用再启用。

## 实例配置

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

同时配置 `media`。公开读取可不登录；需要登录时配置 `bilibili.session: {file,expectedUid}`。私信配置为 `bilibili.channel: {accountUid,ownerUid,sessionFile}`，账号值没有默认值；公开能力与私信同时使用登录态时，预期账号必须一致。私信生产连接当前支持Windows。

公开读取和私信共用一个B站插件；每种接口按实际来源与已配置权限工作。频道账号变更、实例目录冲突、缺失必要库或未知库版本都会停止启动并报告原因，不自动清空或迁移。
