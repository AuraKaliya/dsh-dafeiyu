# 第一阶段接口与实现

版本：0.1.0；接口版本：1。实现仅覆盖本地模拟闭环，外部能力尚未接入。

## 主插件

DSH插件 `@dafeiyu/core` 导出 `name`、`inject`、`apply`，依赖 agents、sessions、sessionPersistence、tools、systemPrompt。提供 `ctx.dafeiyu`。

配置：`agentId`、`dataDir`、`personaFile`、`provider`、`model` 必填；`turnTimeoutMs` 默认600000；`deliveryTimeoutMs` 默认15000。配置在加载时校验。没有每轮模型调用次数上限。

`registerExtension(extension)`：验证接口版本、智能体绑定、扩展标识、操作名和渠道账号唯一性；快照注册元数据。返回：

- `ingest(unknown)`：标准化校验输入，仅接受该扩展所拥有渠道账号的消息；持久化后返回 `{id, duplicate, state}`。
- `dispose()`：注销扩展并合作式取消其操作，旧句柄不能继续接收消息。

核心提供 `getStatus()`、`whenIdle()`、`retryDelivery(id)` 和 `close()`。这些是宿主/维护接口，不自动成为模型工具。`journal` 是可信本地维护与测试接口，没有网络暴露；本阶段不提供模型侧任意历史查询。

## 消息与会话

消息字段：`id`、`occurredAt`、`conversation{channel,account,kind,id}`、`sender{id,displayName}`、`text`、可选`replyTo`。只支持文字，拒绝未知字段、空内容、无效时间和超长正文。暂未展开引用内容；replyTo只是原始关系记录。

会话键是五元组的JSON编码；平台消息编号在该会话内唯一。相同编号但不同规范化内容会报冲突，不覆盖旧记录。发送者变化不改变群会话归属。

创建/恢复DSH会话后，以作用域提示词贡献人格；不使用旧版全量提示词覆盖。每轮人格按文件SHA256记录版本。真实的来源信息与正文写进DSH用户消息，因此模型输入可回放。

同会话排队，不同会话可以并行。模型最终文字自动交付到原渠道会话；流式片段、失败回合不对外发送。第一阶段不实现静默决策、跨会话主动发送和消息编辑。

## 能力操作

扩展注册包含 `id/version/apiVersion/agentId`，可带 `channels`、`actions`。渠道有 `channel/account/deliver`。操作有 `name/description/fields/execute`。

第一版操作参数只支持命名字符串字段；required字段和未知字段严格校验。返回JSON值，未来丰富输入输出类型需演进接口。

核心在各自DSH Agent作用域注册工具并调用DSH执行链，阻断继承的全局工具。DSH的工具更新协议可能保留原工具声明并添加tool-removal事件，因此“旧声明仍在历史”不等于能力仍可执行。测试验证卸载后的调用不能触发真实操作。

每次执行写 `operation.started` 与 `operation.succeeded/failed`，保持同operationId并引用开始事件。失败说明调用未正常完成，不断言外部无副作用。代码回放不执行操作。

插件必须遵守 AbortSignal；同进程JavaScript不能强制杀死忽略取消的扩展。需要硬隔离的能力应放入受管理工作进程，后续阶段实现。

## 持久化与恢复

SQLite仅保存会话映射、入站去重/待处理记录、交付状态和审计事件；完整聊天由DSH JSONL持久化负责。审计数据与工作流状态在同一SQLite事务提交。使用WAL和FULL同步、单机单写者PID/nonce占用；PID仍存在时拒绝另一个核心占用同一数据目录，PID复用也保守拒绝。

状态：accepted → processing → reply-ready → sending → delivered。

- 模型失败：failed，不自动重跑已经发生过的工具动作。
- 明确未发送：回到reply-ready，可显式重试交付，不重新调用模型。
- 发送未知或崩溃遗留processing/sending：uncertain，不自动重发或重跑。
- 重启时accepted可继续处理；reply-ready可交付；delivered不重复。
- 遗留操作开始但无结果时追加operation.unknown。
- 存储故障使自动处理停止并显示错误，不假装接收或交付成功。

未知状态暂不提供人工确认/修复UI，保留证据后由后续维护能力处理。一个会话的历史发送失败不会永久阻塞后续新消息；显式补发可能晚于后续回复，不承诺跨故障绝对交付顺序。

DSH会话写入与SQLite不是跨库事务。先等待DSH持久化，再保存回复；两者之间崩溃会保守停留未知，不能声称端到端恰好一次。

## 生命周期与验收界限

扩展由DSH正常加载；核心仅拥有自己创建的AgentHandle，关闭时取消并释放。示例和测试使用独立Context以及明确关闭顺序，不接管桌面当前会话。

模拟模型只用于验证装配、会话、工具和状态机，不证明人格自然程度、真实模型理解能力、长期上下文压缩质量或平台稳定性。真实模型API、QQ/SnowLuma、记忆分析、专用压缩、部署与自动更新不属于本轮完成范围。
