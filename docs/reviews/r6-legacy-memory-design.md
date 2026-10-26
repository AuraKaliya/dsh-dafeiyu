# R6f4 legacy 记忆只读来源

2026-10-27。本步骤实现读取端，未装入 Host/Memory，未运行构建或测试，未连接服务器、读取真实私密数据或调用模型。它不是旧人格迁移、采用或人工验收。

## 读取边界

由受信程序提供既有服务器 root、QQ 账号/主人及可选 B站账号/主人绑定；打开时核验实际路径与 BigInt 文件身份，固定真实 `运行状态/qq-bridge/state.json.resetAt`。缺失或非法 resetAt 拒绝，不默认 0 或当前时间。每次请求再验证原 root 与 resetAt，变化需程序重新绑定。当前渠道的真实 since 由受信调用方提供，最终边界取两者较晚值。

固定可读文件为上述 state、`共享记忆库/人格记忆/02_可更新偏好.md`、`03_近期状态和关系记忆.md`、QQ 当前用户 `共享记忆库/users/<user>.json` 与其当前 `运行状态/qq-bridge/scopes/<private|group>/<id>/users/<user>.json`。不遍历其他用户或会话，不读固定核心、规则、聊天归档、登录态或旧维护 journal，不执行旧构造器/索引器。缺少可选文件只返回缺项，绝不创建文件或补水位。

scope 来自真实 Core 入站与渠道绑定，包含 platform/account/route/user/since；它是程序数据，不是模型可填写的权限。QQ 私聊必须同一用户，群聊只取当前发言用户；B站仅已绑定主人 route，数字相同也不能读取 QQ profile。私人会话没有跨群或全局主人豁免。

## 历史主张与来源

只解析带明确标记的 JSON 记录。Markdown 基础正文、无来源的旧可更新偏好、summary/names、未知归属和混合会话记录原样保留在磁盘，但不自动送入 prompt。结构化偏好也必须有当前 route/user 的全部来源；不会因为旧 `confirmed` 字段而升级成已采用人格。

共享事实须匹配当前 user，所有源属于当前 route；重新计算旧候选 ID/version，并核对候选仍存在、可共享、sender/message/time 与固化 source 一致。来源被删除、改私密、改内容/置信标签或重置前来源使该事实不可读。人格近期/关系/边界项也须 route/user 明确；近期状态到期即不可读。原消息的任意平台撤回无法仅从这些文件推断：可选程序来源核验端口能进一步拒绝来源；缺少该端口时结果只证明当前 legacy 文件主张，不宣称消息仍在线或已独立证实。

结果为 `legacy-history-claim`，显式 `adopted:false`、`instructionAuthority:false`、`sourceVerification:legacy-files-only`。包含受限文件相对路径、真实文件 SHA256/BigInt 身份、记录摘要、旧来源标识与版本及 scope/reset 摘要。旧置信度单列为 legacy 标签。正文只允许可见文本；已知凭据格式、内部思考标记拒绝，未知扩展字段不输出。不存在能可靠识别任意私密自然语言的万能过滤器，主要隔离保证来自精确 route/user。

reset 引用固定的是 `{root identity, state path, resetAt}` 投影；普通 state.json 游标更新只要 resetAt 不变，不会永久撤销所有记忆。每次读取仍对本次实际 state 文件做前后版本核验。记忆文件本身使用完整字节版本；文件消失、替换或修改会使原 ref 失效。

`resolve(scope, ref)` 重新读取当前有限文件并精确匹配已发 ref；文件替换、任何相关文件版本变化、删项、撤回、到期或 scope 变化均使旧 ref 失效。保守使用整文件版本，可能因无关同行更新要求重新取 ref，不伪称跨文件事务快照。读取前后核对目录/文件身份、字节数与纳秒时间，拒绝链接与读中变更；对有权限的恶意并发目录替换不承诺操作系统级绝对隔离。

## API 与挂载

`openLegacyMemoryReader(binding, options)` 返回只读 reader：`read(scope)`、`resolve(scope, ref)`、`current(scope, ref)`、`close()`；不持有写句柄。程序可选 `sourceCurrent` 端口接现有撤回事实，false 或异常不得放行。root 后续在共享 index 导出，Host 固定绑定 root/账号，Memory 的来源端口只封装受信 Core scope 的调用，不能直接暴露原 API 给模型。

推荐先作为明确标注的按需只读来源供会话引用，来源 guard 每次使用前复核。不写 Memory/Persona，不自动注入全局 prompt，不绕过 propose/review/trial/outcome/adoption/publish。现有旧文件、imports、处理水位与用户重置后的真实记录均不改。

具体生产挂载点（由根代理后续实施，本包未假装已接线）：

1. `CoreService.registerExtensionV3` 注册固定只读 action 与 `resourceProofs`，要求 `memory.capability-observation.v1`；`publicView` 固定 false，不提供跨接收者 `targetView`。模型参数只能是受限分页/已发 ref，不能有路径、account、route、user 或 since。
2. action 先调用 `ctx.dafeiyu.personaAccess(context, pluginId)` 并执行 guard。首版只接受 `context.origin.kind === 'message'`：用 `ctx.dafeiyu.journal.get(context.origin.inboundId)` 的实际 `item.message.sender.id` 取 user，实际 `item.message.conversation` 取 platform/account/route，再经 `authorizeCapabilityResource(context, pluginId, scene)`。还要核验 `journal.messageRecalled({agentId, route:item.route}, item.message.id)` 为 false。不得从模型声称“我是主人”、昵称、task title 或任意源文字推导 principal；非 message 的任务/唤醒先拒绝，后续若支持须有明确持久来源授权。
3. QQ scene 的 private/group 映射为同名 legacy route；Bili 实际绑定私聊映射 `bilibili:<固定主人>`，不根据数值 ID 猜平台。`sinceMs` 来自真实渠道已持久化的接管/路由边界，不取 Date.now 充数；缺少可证明边界就不开放此功能。
4. 每页不超过 `recordCapabilityObservation` 的 8000 字符限制。构造 `ResourceProof`：固定 provider、真实 scene，`roots` 使用稳定 `claim.ref.key`（不能只用易变文件 hash），detail 放精确 scope/refs/可见页 hash；version 可用不可变观察的 1，proof hash 绑定该 detail。通过 `recordCapabilityObservation(context, pluginId, {requestId, proof, text:实际可见页, occurredAt, coverage, counts})` 封存并返回 observation.source。coverage 必须写明历史文件主张及原消息未独立证实，不能写真实经历已确认。
5. provider 的 `current(proof)` 校验 detail/proof hash/scene 与固定绑定，再对每个 ref 调 `reader.resolve(scope, ref)` 或 `reader.current(scope, ref)`；前者返回当前 `LegacyMemoryClaim|null`，后者捕获读取错误返回 false。若重新投影可见页，还须重算同一 view hash。提供程序 `sourceCurrent` 时其撤回结果同样参与；不要仅用静态 epoch 冒充文件当前性。
6. `MemorySourcePolicy.tool` 现有未知工具分支会退到普通 `legacy epoch`，不足以追踪本地文件撤回。须新增精确工具分支，解析 `ActionOutcome.data` 中页与 `observation.source`，调用 `ctx.dafeiyu.capabilityObservationCurrent(scope, ref, SHA256(实际可见页))`，返回 `{kind:'capability',ref}`；失败返回 unavailable。现有 `validate` 的 capability 分支继续逐次调用真实 provider current。这样压缩/后续引用可检测来源变化，而不是只检查本次工具返回。

## 算法依据与验证范围

仅静态参考两份原字节与线上报告一致的本地代码，再次 SHA256 核对：

- `调用限制解除开发/程序/qq-bridge/lib/persona-memory.mjs`：`8965ceb0709d25af055cb02c3019beb629973adf6807c6c8cb5259c2b2aacd2c`；使用记录块、source 字段和 expiry 格式，拒绝复用其无 scope 的基础偏好注入。
- `调用限制解除开发/程序/qq-bridge/lib/shared-memory.mjs`：`7255403ed9e5e8c27a3aeed664673c26466e6e1b15f9b7973010293823a8f8d8`；使用候选 ID/version 派生和同源规则，不导入旧 bridge-core 或任一写端。

已落 `legacy-types.ts`、`legacy-files.ts`、`legacy-memory.ts`，没有新增依赖，未修改共享 index。主代理报告 `a23219c7-c0b2-4a4f-9d47-ed8e5005753d` 中初版读取端 11/11 通过（连同 Windows factory 6 项合计 17/17）；这只证明受管本地虚构数据测试，不证明线上记忆或渠道已接入。

随后精确修正两点：已安装 `sourceCurrent` 端口仅返回 true 才放行（JS 错接 undefined 拒绝）；shared fact 原 ID 不重算，保留旧 commit 输入 section 在 trim 前计算的 ID，归属继续由全部当前 source 的 route/user/version 验证。候选 ID/version 算法仍重算。补一项原 ID 回归和一个错接断言后，主代理报告 `785898f2-6684-4905-b9b1-82b0ef654a0b` 中 12/12 通过，读取端已提交 `3dabd63`。

测试仅创建 D 盘受管虚构目录，覆盖 existing-only/不改字节、reset/since、平台/用户/会话隔离、无来源偏好不曝光、源删改/私密/版本、到期、文件替换和链接、未知私有字段过滤。子代理未运行构建或测试，根代理统一验证。

## 独立服务实现（读取端冻结后）

新增 `legacy-service.ts`，固定注册 `legacy-memory` / `dafeiyu_legacy_memory_read`。构造参数为真实 `DafeiyuService` 和 `{agentId, reader, channels, clock?}`；`channels` 是程序端 `{ready(), binding(scene):{sinceMs,stamp}|null, epoch()}`，方法绑定后保存。stamp 应来自持久账号/渠道边界版本，变更不能恢复旧 stamp；网络断线不等于历史来源永久撤回。服务只借用 reader，close 卸本 extension，Host 在其后关闭 reader。

模型输入严格仅 `{offset:0..63, limit:1..4}`，缺省 0/2。返回 `{page, observation, proof}`：可见 page 最多 8000 字符，标记分页、源预览裁剪和 reader 总上限；始终声明 historical/partial。空页的 observation/proof 为 null，不制造来源。来源正文仅来自当次 reader；旧 Markdown 不写回，不自动建新 Memory/Persona。

仅真实 message origin 放行，principal 取已持久入站的 sender.id/scene，校验 recall 与实际 since。proof.detail 固定入站 hash、scope、binding stamp、精确 refs 与可见页 hash；provider current 每次重新查入站及各 ref。登记 `recordCapabilityObservation` 的 text 就是返回页的原 JSON；根代理已增加 MemorySourcePolicy 的准确能力分支，不再依赖未知工具的 legacy epoch fallback。公开字节与跨目标视图均不授予。

`tests/server-legacy-service.test.ts` 新增 8 项：真实官方 DSH 循环/Core grant/Memory SQLite 的合成模型测试，涵盖页与观察封存、真实 capability dependency、撤回后历史退场、来源篡改、跨用户/会话、模型参数伪造、非 message task 拒绝、空页、不关闭借用 reader、Bili/QQ 分离和分页上限。未运行；未模拟成真实模型或平台验收。Host 生产挂载/导出由根代理另做。

主代理首次服务组合报告 `b1343d27-2932-4658-9df8-24d4a544763f`：构建/两组类型检查通过，13 项中 12 通过、1 失败（service 7/8、B05 source-contract 5/5）。失败是测试误期待伪造参数产生 ActionOutcome。只读核对闭合现场：真实 DSH tool/result 为 `isError=true`、`Error: INVALID_INPUT`；Core runtime 的 legacy operation 数为 0，Memory capability observation 数为 0。静态路径 `ExecutionCoordinator` 先 `action.validateInput(raw)`，输入不合规时尚未建 operation，由 SDK 封装工具诊断。

已仅修该测试：校验真实工具诊断、零 operation、零 reader.read 次数、零 observation/Memory；随后独立执行 fabricated grant 的 SCOPE_DENIED 断言。计数子类只包裹原 reader.read，不替换业务行为。生产服务与读取端未改；仍为 8 项，修正后待主代理复测。该报告保留失败现场 18085751 字节，cleanup blocked 为空；真实模型/平台/服务器标志均 false。
