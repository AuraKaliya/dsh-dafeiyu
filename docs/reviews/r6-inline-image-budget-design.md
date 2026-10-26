# R6f-2：视觉请求的一次派发方案

2026-10-26，主代理静态核对本项目安装的 DSH 0.2.1-rc.2 公开类型与实现。没有运行模型或 HTTP 请求。此设计补充 `r6-deepseek-retry-metering-audit.md` 的 7D 未完成项，不撤销该门槛。

## 可用的官方接口

`@deepseek-ai/dsh-llm-deepseek` 公开导出 DeepSeekAdapter、DeepSeekFileStore 与 DeepSeekUploadIndex。Adapter 的公开 dependencies 包含 `resolveFiles(): DeepSeekFileStore`；FileStore 的 `ensureUploaded`、`invalidate`、`release` 等方法可被有类型的子类覆盖。其默认 UploadIndex 构造器只记路径，实际 load/save 才读写索引。

当前官方 `request` 先 prepareImages，再通过 RequestFiles.resolve 调用 ensureUploaded。该调用失败会变为 FileResolutionFailure，request 进入 inline fallback，重新序列化为 base64 图像；没有成功得到 fileId 的请求，RequestFiles.used 为空。之后 `/messages` 错误中的 files.retry 在 used 为空时直接 false，不发生第二次 HTTP 请求。正常错误重试仍是另一机制，应显式设为零。

官方 `registerDeepSeekProvider` 的类型只开放配置、auth、catalog、connect/admit，并不暴露 resolveFiles；不能强行给其传额外字段或 monkeypatch 现有桌面 adapter。可沿用本项目真实验收入口已有的方式，直接装配官方 DeepSeekAdapter，保留官方协议序列化、图片读取与流解析，仅选择公开的文件传输依赖。

## 最小实施

在新 Host 的受信模型配置中增加可选的固定 inline 传输选项，缺字段时旧配置保持。选择 inline 时：

- 固定 FileStore 子类在 ensureUploaded 进入任何索引/网络调用之前拒绝文件上传；所有其它远端文件管理入口也拒绝。不伪造上传成功或 fileId，不触碰已有桌面 Files 索引。
- 官方 Adapter 按其既有 fallback 将真实图像字节编码在一次 `/messages` 中，继续限制图像数、尺寸、总 base64 字节和上下文预算。超过上限明确拒绝，不截断后声称已看全，不切回 Files API。
- 凭据从已经绑定的官方 Credentials 服务取值，仅用于固定端点；禁止环境回退、动态模型／端点变化和不受控扩展字段。每次实际解析前核验凭据与候选摘要，metadata 和日志不含值。
- 父模型、摘要、视觉分析等仍经统一模型准入；用户设定的总预算/原时钟保持。不改官方 SDK、本机桌面 profile、专用文本 CLI 或每轮调用次数。

必须先通过真实已装 Adapter 的无网络契约测试，才能把此路径用作 7D 前提；仅依据本段源码推论不能放行真实视觉请求。

## 必需的定向验证

1. 实际 AttachmentStore 提供本地合成 PNG；fetch 为明确拒绝公网的测试端口。成功场景只能出现一次 `/messages`，消息体必须有与原字节一致的 base64 图像，Files/upload/delete 调用数为零，计费预留/结算各一次。
2. 测试提供方返回失效 fileId 错误：实际 Adapter 不再发第二次请求；用量缺失时保留未知或完整授权上界，不能当零费用。
3. 真实图片越界、来源过期、超出 inline 字节或预留拒绝，都在消息派发前停止；允许明确的保守费用占用，不伪造模型已看图。
4. 取消、流截断、用量错误以及多个图像/辅助会话仍只使用同一预算所有者；流失败不能被默认 normal 重试绕过。
5. Host 中实际 MediaService 的 ScopedImages→隔离分析→SharedTransport→父 SDK 路径覆盖，而非仅测试一个孤立 mock Adapter。原文本模型、旧无该字段的 profile 和专用 CLI 继续通过其相关检查。

测试不得读取私人媒体、真实密钥或调用真实 API。通过后再保存实际报告、更新 7D 放行条款和候选指纹；真实视觉质量与服务器 SDK 实例仍须独立验收。
