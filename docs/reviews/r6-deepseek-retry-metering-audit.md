# R6：DeepSeek 重试与专用文本 CLI 计费边界

2026-10-26。只读核对本机已安装的 DSH 0.2.1-rc.2 公开源码；没有读取真实密钥、发送 HTTP、调用模型或连接服务器。下面是代码事实与受限实现推论，不是已发生超支的报告。

## 两种不同的重试

1. **提供方 normal 策略。** `dsh-llm` 的 `resolveRetryPolicy` 在省略配置时选择 `normal / maxRetries=5`。DeepSeek 的 `providerRetryPolicy()` 仅返回该策略；LlmRuntime 把它绑定到 prepared call。`dsh-llm-retry` 在 `agent/request-error` 上决定是否重试，AgentLoop 回到下一次 `prepareRequest` / `preparedCall.stream`。prepared call 的 stream 仍调用 `streamWithRegistration`，后者执行 `llm/stream` waterfall。因此这一类重试每次都会重新经过子进程计费中间件。
2. **适配器内部 Files 重试。** `DeepSeekAdapter.request()` 自己有 HTTP 循环：发送 `/messages` 后，如错误命中 `files.retry(detail)`，直接 `continue` 再发送。`RequestFiles.retry` 在本次使用了文件 ID 且提供方报告失效 ID 时，最多允许一次内部再派发。它不读取 `retryPolicy`，也不会重新经过 `llm/stream`。Files 上传／失效处理还存在独立 HTTP 操作，不能仅凭外层模型调用数宣称均已计费。

关键源码位置（均为本机实际安装目录 `D:/DSH/DSH Desktop/resources/app/node_modules/@deepseek-ai/`）：

| 文件与位置 | 事实 |
|---|---|
| `dsh-llm/lib/index.js:247,316` | 默认 normal 五次及显式策略解析。 |
| `dsh-llm-deepseek/lib/index.js:2101` | providerRetryPolicy 返回配置中的策略。 |
| `dsh-llm/lib/index.js:2249,2396` | prepared stream 仍进入 llm/stream。 |
| `dsh-agent-loop/lib/index.js:1084,1136` | 请求失败恢复与下一次 stream。 |
| `dsh-llm-retry/lib/index.js:151,175` | agent/request-error 的策略执行。 |
| `dsh-llm-deepseek/lib/index.js:2179,2217,2241` | request 内部 HTTP 循环、POST、Files retry 后直接 continue。 |
| `dsh-llm-deepseek/lib/index.js:1320` | used 为空时不重试；失效文件 ID 的一次重试不受 normal 策略控制。 |
| `dsh-llm-deepseek/lib/index.js:1418,1457` | 只有结构化 image 会准备图片版本并加入 RequestFiles.used。 |
| `dsh-llm/lib/index.js:2336` | 文件先转文本；仅文本模型的 image 也投影为文本。 |

服务器 CLI 与 Desktop 是不同安装实例。部署仍须核对所选 CLI 实例的固定源码与 manifest pins，不能只凭同一版本号互相替代。

## 本次最小强化

- 仅新专用 headless profile 的官方 DeepSeek 配置显式写入 `retryPolicy: { mode: 'normal', maxRetries: 0 }`。这关闭 normal 错误自动重试，**不声称它关闭了 Files retry**。
- 专用 child 的 `llm/stream` 入口在 `reserve` 前执行 `assertHeadlessTextRequest`，拒绝 image、file、audio 及其它未准入内容类型。只保留文本、reasoning 标签和原生工具调用／工具定义变更结构；检查只读取类型标签，不读取或归档 reasoning 正文。
- production catalog 原有 `inputModalities: ['text']` 保留。输入侧拒绝与 SDK 文本投影共同保证该专用 CLI 的 `RequestFiles.used` 为空，从而使内部失效文件 ID 再派发分支不可达。这是基于当前受信 SDK 代码和固定文本契约的推论，媒体能力不能继承此结论。
- 普通文本及工具调用仍可连续进行，没有恢复每轮调用次数上限。费用、未知结算、原累计时钟与唯一父账本规则保持原样。
- 父 Host、其多模态入口和官方 SDK 源码均未修改。

## 验证范围

新增官方配置契约测试直接导入本机已装 `dsh-llm-deepseek-api-key` 的 `Config`、`plainOptions`、`resolveAdapterOptions`，验证生成的 production 配置确被官方解析器接受，路由／端点／上下文／输出界限／文本能力／normal 零次重试均按固定值解析；另核对省略策略确会回到五次。测试期间把 fetch 替换为拒绝桩，必须没有任何 fetch 调用。

新增 DSH 中间件测试送入合成 image、file 与未知 audio 标签，要求 reservation 和适配器派发均为零；随后普通文本仍能正常预留、派发、结算。没有读取附件字节，也没有 HTTP 请求。

主代理受管复验记录 `21470e1c-fae9-452d-933d-d52980fb80a2`：凭据 8 项、headless 6 项、transport 10 项均通过；同批 Host 执行器 6 项、存储迁移 8 项通过，共 38/38，无跳过。此前一轮在新输入检查的 TypeScript 类型错误处停止，未执行测试；修正为逐层 unknown 窄化后才取得本次结果。所有模型均为脚本替身，实际启动官方 CLI、文件与命令工具只证明本机接线，不代表真实提供方、线上凭据或服务器验收。成功临时目录已经回收，失败保留和清理策略未变。

## 7D 独立门槛

当前 7C 是文本验收，本次没有证明其存在真实超支，也不改旧费用或旧失败证据。

父 Host 未来做 7D 真实视觉验收时，不能自动套用文本 CLI 的计费证明。必须单独验证 Files 上传、失效 ID 处理、内部 `/messages` 再派发、每次 usage 与未知费用的对应关系；需有可证明的逐派发预算准入／结算，或实际关闭该传输分支的受信机制。仅设置 normal `maxRetries: 0`、只数 `llm/stream` 或把首个 HTTP 错误当零费用都不足以放行视觉调用。
