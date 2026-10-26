# R6 B站主人渠道实现审计

2026-10-26。AI 独立静态审查，对照 `r6-bili-owner-channel-design.md` 检查新包、现行旧 worker 的取回源码及 Core/Journal 接口。未修改业务/测试源码，未构建、测试、连接服务器或调用模型；本文不构成真实私信验收。当前 transport 为程序注入端口是本步骤已声明范围，不作为新发现。

## 结论与截点

发现 5 个具体场景，均已直接发根代理与实现代理 B。5 项均获 B 确认，且已在随后源码中看到对应修正。所有修正仍需根代理统一定向测试，不能仅凭静态看到代码认定通过。

本次后段读取的源码截点（实现代理仍在补测试）：

| 文件 | SHA256 |
| --- | --- |
| `packages/channel-bili-owner/src/store.ts` | `eda4416553782499600c0d1efae0c3af29f34712c81818d7e27eb9a29ad68fa3` |
| `packages/channel-bili-owner/src/service.ts` | `2ecee4217f61e0b8017d8d5cca1d0f9224941b3b63f4ae521247bf34051e6572` |
| `packages/channel-bili-owner/src/tasks.ts` | `8a88aa14646fe2800bbb247556256866fb0b4fa28120ce4038a7162592d91ba7` |
| `packages/channel-bili-owner/src/types.ts` | `c189e57390b47f9e269b77004adad287659a2e402552bf9aeac198e84f05d59a` |

旧 worker 依据：取回 JSON 中 `程序/bili-lite/dm-worker.mjs`，原 SHA256 `2d1427a0e942be9f0b23e9b06473d19ddc27fb623b37c1700bde0909f7c83ed8`。只读取源码，未读取实际 queue、seen、since、登录态或私信。

## 具体发现与复现场景

### 1. 未决发送可用新 replyId 再建请求（已见修正，未测试）

原 `BiliOwnerStore.prepareReply` 只按 reply.id 查旧 delivery。对同一 accepted source，r1 经 prepared → sending → unknown 后，用同一 scene/source/text 和新 r2 调 prepareReply，会生成另一个 requestId 并进入 prepared，绕过旧 unknown 的同 ID 拒重。

已见修正：新增唯一 `logical_key`；普通回复绑定 `reply:<coreInboundId>`，Task结果绑定 `task-result:<anchor.runId>`。新 replyId 不能重建同一逻辑交付，ACK 与 Task结果仍分开。`delivery()` 重验 logical_key，plan不可变 trigger 也覆盖该列。B 已补 Store 场景；仍须真实 Core/渠道检查既有 reply 重放与 Task结果独立交付。

### 2. quiesce 仍可受理新 Task（已见修正，未测试）

原 `sourceReady()` 在 quiescing 仍 true，Tasks.access 与 binding.active 共用它。当 Core 仍 active、原对话 Run 正在执行时，单独 channel.quiesce 后仍可 submit 新 Task；这混淆了“旧来源继续可核验”与“允许新工作”。

已见修正：Tasks 新增独立 admitting 回调，要求 active、未 held 且来源当前有效；submit/control 的写动作拒绝关闭的准入，status 保持只读。binding.active 仍保留旧来源排空所需的验证，不用撤销来源来阻止新任务。

### 3. 旧 queue 的 Number 碰撞可重跑已 claimed 工作（已见修正，未测试）

实际旧 worker 第13行把版本提升为 idPrecisionVersion=2 时，只复制 seen 到 legacySeen，没有重新获得 queue 中 ID/seqno 的精确值。

复现：导入 `queue:[{id:'9007199254740992',seqno:'9007199254740992',claimed:true,...}]`，legacySeen=[]，version=2，since 合格且 legacyIdUntil 覆盖该消息。原真实值可能是 9007199254740993；其精确 read 页到来时，原 observe 仅查 legacySeen，不查 queue 的舍入等价类，于是创建 pending，可能再次调用模型。claimed=false 的旧 held 也存在同一歧义。

已见修正：在旧窗口内比较旧 queue 不安全 ID/seqno 的 Number 等价类，缺窗口时保守处理；精确新 ID 原样保存为 legacy-unknown，不覆盖原 held/claimed 或导入原文。代码中的 Number 仅检测历史损失，不替换新 ID、排序或充当已送达证明。B 已加入 claimed true/false 的纯 Store 场景。

### 4. pending 容量导致轮询永久停滞（已见修正，未测试）

原 poll 在全部 page 循环完成后才 admitPending。配置 maxPending=30、maxPagesPerTick≥2：第一页30条进入 pending，第二页新增消息触发容量错误并 backoff，已存 pending 没有进入 Core；之后继续同一 cursor，每次都满，永远无法下降。maxPending=1 时固定请求 limit=30，首个含2条的页就整体回滚，甚至没有可排空的 pending。Core 暂不 accepting 时积压也会触发。

已见修正：verify 成功后先 admit 已有 pending，每页成功后再次 admit；请求 limit=min(30,剩余容量)，无余量保留 cursor 停止读取；返回条数超过本次 limit 拒绝。应测试 Core admissionHeld → 恢复、maxPending=1、多页/重复页，证明没有跳 cursor 或丢消息。B 已确认补真实 DSH 渠道场景。

### 5. 渠道撤回已持久化但 Core 观察丢失（已见修正，未测试）

原 `service.recall` 先 store.recall，再 handle.observe；原 recover 只把 sending 收敛为 unknown。两库之间崩溃后，本地 source=recalled，但 Core journal.messageRecalled 仍 false。

发送的 checkSource 会因本地状态挡住，因此不能把此问题说成“会照常发送”；但 Core Task 的 validateMessageSource 查询的是 Core journal 撤回事实，可能继续把已撤回来源当有效。

最小复现：先正常入站及 Task绑定，仅执行本地 store.recall 模拟崩溃截点，重开 channel/recover 后核对 Core 的 messageRecalled 与任务来源复验。建议在恢复时对已持久 recalled 来源先查 Core、缺失才补 observe，或持久化可重放 outbox；只补程序事实，不重跑模型/Task/发送，不把页面缺消息当成撤回。

已见修正：Store.recalled() 经现有 source hash/tail 校验返回已持久撤回 ID；channel.recover 在 handover 有效后逐条调用 recordRecall，仅 Core 尚未观察时补写；即时 recall 复用同一去重函数。B 已安排模拟两库间中断的恢复断言，尚未运行。

## 已核对的保留与边界

- importLegacy 在单一 SQLite 事务中保存完整已解析旧 state 与 sourceHash/bodyHash，冲突回滚；seen 为 tombstone，未 claimed 为 held，claimed 为 legacy-unknown。since 缺失或旧 precision 未解决时 bindingReady=false，不以启动时间/0 补边界。
- held 进入 pending 前须在固定双方的真实 page 中重新观察，完整 message hash 一致；claimed/legacy-unknown 不进入 pending。旧 state 的其他字段仍在 handover body 中，不被创建新会话或人格初始化消费。
- 新 id/seqno 为十进制字符串，排序使用 BigInt 比较；timestamp/since 单位转换在声明范围内，不把 BigInt 差值转换成 Number 排序。
- 本地 pending → Core handle.ingest → 本地 accepted 保留相同规范消息。Core `Journal.accept` 按 conversationKey + platformId 去重并比较完整 payload；重复给回同 inboundId。Core handle 只对 accepted/reply-ready 重新排队，不重跑 processing/failed/uncertain 模型轮次。第4项修复也让已持久 pending 不必等所有新页成功才恢复绑定。
- scene 固定 bilibili/account170759822/private/13461350。message schema 校验实际双方；own-message 不 ingest，非文字为 unsupported。mainText 使用真实原文，不加入伪主人指令。发送计划同时绑定 source hash、Core inboundId、scene、原 bodyHash 与 trim 后 wireHash。
- 每次发送校验 Core journal 的 extension、原消息、scope、撤回及 Task anchor；Core 提供的 authority 回调在出网前再次运行。text-only、空白/非法 surrogate/超过1000 codepoint 在发送前阻断，不截断。
- begin 在 transport 调用前持久 sending；已调用后抛错/回执不明保持 unknown，恢复不会变回 prepared。真正未调用的 guard 失败或 transport 明确 not-dispatched 才可留 prepared。确认成功仍保存实际回执，不因后来的取消反写成无效果。
- guard 每次验证固定 consumer key、持久 epoch、transport identityHash，以及双方绑定结果；来源复验与新任务准入现已分开。不同 dataDir 争同账号的排他性仍由受信机器级 lease 实现负责，注入接口本身不证明它已在线生效。
- open 转移所注入端口的资源所有权；失败路径释放端口，正常 close 停准入/取消/等待在途后关闭任务注册、channel handle、store、transport、lease及自身 fiber。已见 effect 在由父 scope dispose 触发时清除 ownedFiber，避免 close 再递归等待同一 fiber；没有关闭整个父 Context 的路径。

## 尚未取得的证据

本次只看到 Store 测试正在补齐，未运行任何测试；跨库崩溃、Task quiesce、容量恢复、端口只释放一次和父服务保留仍需实际定向报告。旧 state 的 since、帐号、当前 queue/claimed、实际lease接管与 transport pins 没有本轮线上事实，不能声称已安全切换。

B 后续代码若改变上述哈希，应以统一测试候选重新核对。所有发现是 AI 代码审阅，不能替代真实固定主人入站/回复验收，也不能被用于提前恢复旧 worker、改写其 state 或清除未知发送。
