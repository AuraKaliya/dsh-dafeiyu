# R6 B站主人私信接管方案

状态：设计稿，尚未实现、部署或验收。2026-10-26，仅读取已保存的脱敏线上源码快照与本项目代码；未连接服务器、打开凭据／私信队列／会话、执行应用、测试、模型或 Git。

## 1. 范围与当前证据

采用固定 `channel-bili-owner`，账号 **170759822**、唯一私信对象 **13461350**。复用经过版本与依赖闭包校验的现行账号通信层；不加载旧 `index.js/apply`、`OwnerDmWorker`、`PersonaMemory`、技能或全局工具。普通私信走新 Core 人格会话；视频探索走独立 `bili-owner-tasks` 的真实 Task，结果由 NativeTaskDelivery 重新整理回原 B站私聊。

依据为 [server-compatibility-source-20261026.json](<D:/DSH/DSH workspace/dafeiyu/.runtime/deployment/server-compatibility-source-20261026.json>)，观测时间 `2026-10-26T14:47:50.2291349+00:00`。下文 D/A/U 的行号均指该 JSON 中相应 `files[].source` 的行号，不是旧管理中心镜像。

| 标识 | 服务器文件 | 原始文件 SHA256 | 已确认事实 |
|---|---|---|---|
| D | `程序/bili-lite/dm-worker.mjs` | `2d1427a0e942be9f0b23e9b06473d19ddc27fb623b37c1700bde0909f7c83ed8` | 无脱敏缺行；1/32行已有 `maintenancePaused`，7行仍依赖旧 QQ 人格，86行启动器只绑定旧 desktop home。 |
| A | `程序/bili-lite/account.mjs` | `eba78df03ec54ac976c7920410c3476f332c588da8d2bc5d3bcdc39b1f891768` | 83–101行固定对象 readDm/sendDm；1000 codepoint 上限；publish 有开始／成功／未知分支；35行受 `DAFEIYU_BILI_READONLY` 约束。 |
| U | `程序/bili-lite/auth.mjs` | `ae81e655b9f264de109ee3bc3377e8d722c89589c3e41d3cf218d712feab952c` | 14行保留大整数ID；26–30行绑定主人／独立账号；38–48行固定HTTPS主机、拒重定向与风险响应。 |

实际 package 是 `dsh-bili-lite 0.3.3-dafeiyu.1`。A 第31/33/40/41行及 U 部分构造／请求代码被保守脱敏遮住，不能拿旧镜像补成“现行已审查”。A 仍静态 import `../qq-bridge/lib/history-store.mjs`，而本快照只包含 v073 的 history-store；正式 pinned loader 前须核实这个实际路径及其静态依赖。快照不是可执行代码包，pins 使用原始文件 hash，不能 hash 脱敏正文代替。

D 第12–58行保存 seen、queue、claimed、since、legacySeen、legacyIdUntil、idPrecisionVersion；先 claimed 后模型，重启发现 claimed 不重放。D 64–75行取最终文字、固定 `auto-<messageId>` 发送并写原人格观察。新实现保留这些处理事实，不继续旧人格写端。

## 2. Core 接入与真实任务边界

固定 scene：`{channel:'bilibili',account:'170759822',kind:'private',id:'13461350'}`；新 `conversationKey` 含 agent/channel/account/kind/id，不复用旧字符串 `bilibili:13461350` 作为全局会话键。

渠道使用现有 [ChannelCapability](<D:/DSH/DSH workspace/dafeiyu/packages/contracts/src/index.ts:85>) 与 `registerExtension`：id=`channel-bili-owner`，固定 channel/account，managed lifecycle，`deliveryValidation:'per-segment'`；不注册媒体发送或通用 send 动作。这个注册接口不意味着运行旧插件。

入站由 transport 验证实际账号及消息 sender/receiver 后构造 `InboundMessage`：平台原 ID、原时间、`sender.id='13461350'`、真实文字同时作为 text/mainText。不要在 mainText 前拼“主人指令”或模型生成的来源说明；Core 本身附加程序来源信息。非文字消息仅记 unsupported，不把占位文本当成用户下达的任务；自身发出的消息不再次 ingest。

新增 `bili-owner-tasks` V3 扩展，仅提供以下三个动作，复用 [MessageTaskBinding](<D:/DSH/DSH workspace/dafeiyu/packages/contracts/src/message-task.ts:19>) 与现有 Core Task 存储：

| 动作 | 输入／程序边界 |
|---|---|
| `bili_owner_task_submit` | 采用 MessageTaskSubmitSchema 的文字子集；拒 voiceExposureId。explicit-task 不接模型 goal，目标从真实主人的 mainText 分类取得；self-exploration 必须单独给兴趣 goal，保留 self-exploration 动机，不能伪装主人命令。 |
| `bili_owner_task_status` | 当前 B站 scene 所发起 Task 的状态；按原 binding、producer、scope 核验，不凭 taskId跨读。 |
| `bili_owner_task_control` | 当前真实主人 mainText 中明确的取消／修改／确认继续指示；校验 taskVersion、原scene及原来源。引用、网页文字、昵称和模型参数均不能发起控制。 |

Binding 固定：`id=pluginId='bili-owner-tasks'`，`channelExtensionId='channel-bili-owner'`，上述 account/owner/scene，`policyId='bili-owner-task'`，明确 version，`autoDeliver:true`。不引用 QQ 的 ownerId、binding 或 authority hash。`active()` 以实际渠道归属／生命周期为准，排空时保留既有来源复验，撤销／更换账号或切换归属后失效。

Task policy 固定 producers=`['bili-owner-tasks']`，不写 `externalActions`；资源仅当前 owner scene 与 `BILI_SCENE` 公共材料，不含 QQ、其它私信或 server-executor scene。动作白名单为 `bili_discover`、`bili_search_sources`、`bili_search`、`bili_video`、`bili_comments`、`bili_subtitles`、`bili_danmaku`、`bili_media`、`bili_observe_select`、`dafeiyu_media_acquire`、`dafeiyu_media_inspect`、`dafeiyu_media_read`、`dafeiyu_media_select`、`dafeiyu_task_intent`、`dafeiyu_task_object`。这里“只读”指没有平台发布或服务器执行；观察选择所需本地写单独由 `allowLocalWrite` 授权。不开 `dafeiyu_media_reply`、QQ工具、任意网络工具、旧 publish 工具或 server-executor。

`explorationResources` 也只列同一公共 Bili资源，不能因自主兴趣扩大平台范围。若以后增加 Activity wake，需另立真实 wake 来源；本方案不伪造一次主人消息作为定时任务授权。

现 Core 只有一个 id=`conversation` 的 policy，QQ 与 Bili producer共用时可能看到彼此 submit/status/control 名称。首版依 [messageAuthority](<D:/DSH/DSH workspace/dafeiyu/packages/core/src/execution-coordinator.ts:99>) 的真实 extension/channel/account/binding 检查硬拒 cross-origin，并用独立动作名说明所属渠道；不能依据模型传入 owner 参数判断。可另做 producer 展示过滤，但不能用隐藏工具替代执行检查。B站消息即使自称主人或调用 QQ 动作，也不能获得 QQ binding；Core 外部执行来源目前还明确要求 QQ，保持不变。

渠道提供 `deliverTaskResult(reply,anchor,signal,authority)`：要求 anchor.target 等于固定 scene、sourceMessageId 对应本渠道真实 inbound、Core给出的有效来源回调；先 NativeExpression 按目标核验公共 Bili/Media 材料，再由目标人格 DSH 会话整理并独立验证，最后走同一私信 outbox。不能直接发送原 Task 正文、旧 worker 最终文字或 CLI 报告。字幕、帧、音轨各自保留实际覆盖，不能把字幕等同完整观看。

## 3. 固定 transport 与程序依赖接口

新增程序侧 `BiliOwnerTransport`，仅由受信启动器创建，不进入模型输入：

| 方法 | 最小契约 |
|---|---|
| `verify(signal)` | 返回 `{accountUid:'170759822',ownerUid:'13461350',loggedIn:true,bindingStamp}`；本地配置／凭据身份与远端当前登录身份一致才成功。返回无 cookies、session、请求headers。 |
| `readOwnerPage({beforeSeqno?,limit},signal,guard)` | limit有界；返回规范消息、hasMore、nextBeforeSeqno及bindingStamp。对象固定，调用者不传UID/URL。每条保留精确十进制字符串ID、seqno、真实双方UID、type、timestamp、text；再次独立验证双方身份。 |
| `sendOwnerText({requestId,text,wireHash},signal,guard)` | 固定唯一收件人；返回 confirmed receipt，或明确 not-dispatched / unknown。只有实际平台 msgKey 与请求绑定后可 confirmed。guard 在实际 POST 前再次运行。 |
| `lookupReceipt(requestId)` | 只查此受管请求在旧持久发布账本中的精确 start/done/hash/receipt 状态，不读取或导出任意历史聊天。缺 done、无匹配项或只有文字相似均不能推断没发送。 |
| `guard()` / `close()` | 校验固定源码pins／账号配置版本／归属；释放自身资源，不关闭旧桌面或其它插件。 |

生产 factory 只加载经审核的 `BiliAuth`、`BiliAccount` 及确切依赖，不调用 `registerAccountTools`，不 import index/worker。显式传受信 root，不能依赖模型可变 env 来改root或对象；不使用导出的默认 singleton 代替所绑定实例。配置只含固定UID literals、public manifest路径/hash、poll/backoff和受管dataDir。正式依赖不能被 JSON 中的 modulePath/fetch/actor/mode替换；离线替身仅程序侧且限 test+scripted profile。

Pins覆盖 package、auth、account、实际 HistoryStore 及其静态依赖、受信 wrapper；校验真实路径／别名和hash后才加载，调用前再校验。对当前源码被遮掉的发布幂等事务和auth构造行为，先补服务器侧受限代码核验／无网络合同验证，再确定可执行manifest。不能只pin入口而让相对 import 随线上目录变化。

auth.session/cookieHeader 只在服务器端使用现有账号文件；新Host、headless提示词、日志、Git和开发机都不接收凭据内容。不登录、不换账号、不复制本机登录态。`DAFEIYU_BILI_READONLY=1` 的现行拒写规则不能被 wrapper静默取消；正式启动需明确选定允许此固定DM渠道的受信运行环境，公开读取能力仍无发布入口。

现 auth.request 有内部 timeout，没有调用方 AbortSignal；wrapper 必须通过受信 fetchImpl 把原 signal、渠道取消和调用超时合并，并限定实际 read/nav/send 路径、方法及固定双方ID。读取使用有界响应字节／JSON深度与消息正文校验，不能只凭page size约束无界response.text。在真实发送调用前设置 dispatched 事实；写请求一旦可能出网，超时、断链、取消或无法确认回执都归 unknown。错误只输出稳定code，不能直接转存可能含敏感内容的原异常／请求体。

## 4. 持久状态与幂等

新库 `bili-owner.sqlite` 独立于现有公开读取 `bilibili.sqlite`、Core journal 和旧 history.sqlite，schema v1、独立 application ID。表名／主键最小约定：

| 表 | 内容与约束 |
|---|---|
| `channel_binding` | 单行不可变 agent/account/owner/transport manifest identity；运行归属 generation另按追加事件变更，不修改历史绑定。 |
| `inbound_messages` | 固定双方+platformId唯一；payloadHash、精确seqno、timestamp、状态、可选本地私有payload、coreInboundId。重复同ID同hash幂等，异hash冲突不得覆盖。legacy seen 可只有tombstone。 |
| `deliveries` | replyId主键，requestId唯一；本地sourceId外键，Core inbound/run只保存并核验引用（不能跨SQLite造外键）；kind reply/task-result、anchorHash、targetHash、原bodyHash、wireHash、状态与平台receipt。 |
| `imports` | source文件hash／原schema／since／idPrecisionVersion／legacyIdUntil／旧sessionId／cutover generation／计数与完成记录；不得用成功标志替代实际逐行迁移事务。 |
| `poll_state` | 完整扫描水位、当前分页cursor、是否覆盖完整、backoff；所有ID保留字符串。读取上限只产生明确coverage，不跳过未覆盖区间。 |
| `events` | 单调seq、对象id/version、类型、内容hash；追加而不改旧记录。记录准入／派发／回执／暂停／恢复／迁移，不含内部思考或凭据。 |

入站交接：先持久本地 pending → 用相同 scene/platformId/hash调用 Core handle.ingest → 保存 coreInboundId。两个库不假装原子事务；崩溃后只对同一规范消息重复 ingest，由 Core journal去重。Core已开始或失败的模型轮次不通过换ID重跑。未获Core准入只保留 pending，不冒充已处理。

出站：`prepared → dispatched → sent | unknown`，另有派发前 `blocked/not-dispatched`。requestId由 account+owner+Core replyId确定（如 `bili1_<sha256>`，满足旧8–100字符格式），与body/target/hash唯一绑定；同reply换文字冲突。发送前持久 dispatched，之后真实成功才写receipt。恢复 dispatched无确定回执一律unknown，不能换requestId重试。已确认sent返回原receipt而不再调用平台。

旧 publish 的账本与新渠道库可同时留证但不能假装跨库事务：若平台成功而新库／Core确认失败，保留unknown或“transport已确认、Core待核对”；首版不自动改Core uncertain记录。若未来需要无重发地回填Core，须另加受信回执核对接口，不直接写Core私表。旧账本能按精确rid/hash找回真实平台receipt时可以修复本渠道记录，但不因此开启一次新发送。

每次 deliver 必须验证：固定scene、原真实入站及payloadHash仍一致、Core回调来源仍有效、Task anchor未过期／被替换、当前账号及consumer lease有效、pins不变、signal未取消。普通回复与 Task结果分别记replyId，不把“已受理”ACK与最终任务回复当作同一条消息。撤回的检测只依据实际平台／程序事实；平台未提供撤回信息时明确未知，不宣称已全量监测。

## 5. 首版文字与轮询策略

选用**单条最多1000个Unicode codepoint**，与 D71/A12一致；不新增分段协议。只允许旧 transport已有的首尾空白trim作为明确wire规范化，同时保留Core bodyHash与wireHash；不改内部正文、不截断、不自动摘要。description向模型说明文字上限与渠道能力，发送前仍做硬检查。1001字、空白或media回复在出网前持久blocked，返回not-sent；相同body恢复时不再请求模型或网络。不能伪称已经送达。

初版轮询默认30秒、至少15秒；412/429与网络故障进入持久backoff，不连续撞接口。单页≤30，单tick有明确读取界限；未回到既有水位时保留nextBeforeSeqno继续，不把有限页数当作“已读全部”。原seen及新精确ID表防重，不因3000条窗口淘汰而重新回复旧消息。

所有模型工作由Core／现有Task、Media生命周期管理，经过同一真实预算授权与计费观察；渠道本身不另开模型循环或旧计数器。分页／队列容量限制不恢复旧每轮工具调用次数上限。

## 6. 旧状态服务器内迁移

迁移只在服务器本地处理 `运行状态/bilibili/dm-worker.json` 和所需精确发布回执。先备份并hash冻结；不下载队列、正文、session、history payload或凭据。对外只返回schema、hash、计数、状态和错误码。

| 旧字段／状态 | 保留与解释 |
|---|---|
| seen | 保留原集合为legacy tombstones，不重新ingest或重发；不要凭“新库为空”丢弃。 |
| queue、claimed=false | 保存原消息、顺序与hash。被新渠道受理前用固定transport回查并核对实际双方/ID/正文；暂不可核验则held，不假造真实新入站。 |
| queue、claimed=true | 可能已经调用模型或发送。仅凭精确旧requestId/account/target/hash及真实done/msgKey判定已送达；其余保持legacy-unknown，不再次调用模型或发送。不能把查无记录当作未发送证明。 |
| since | 保留原边界，不能替换成部署时间或0。缺失／冲突需服务器侧明确建立cutover水位，保持未覆盖区间，不重跑旧初始化。 |
| idPrecisionVersion、legacySeen、legacyIdUntil | 原样保留；用无损数字解析保存写下的十进制表示。无法恢复已经被Number舍入的历史ID时标记歧义，禁止猜成精确新ID并重放。 |
| accountUid、sessionId、created、lastPollAt/lastReplyAt | 校验账号必须匹配固定独立账号；旧sessionId只作历史来源，不启动／复制旧persona session。新Core自行管理它的scene session。 |

消息排序采用BigInt比较seqno，不用 `Number(BigInt差值)`。一条旧状态即使暂不能处理也保留在受管迁移档案与状态表，不静默删除；unknown只能由后续受信实际回执核对收敛，不能由模型写“已处理”。真实新增记忆、旧关系和撤回状态按独立兼容计划保留，不把DM迁移变成旧人格正文导入或已采用资格。

## 7. Host、唯一消费者与切换／回滚

Host固定枚举新增 `channel-bili-owner`，`paths.channels`仅额外接受这个固定key，不能开放任意模块导入。声明 Core registration、Memory源跟踪／native-expression、execution.message-task、delivery.task-result；视频探索还要求现有Bili/Media服务及具体模态就绪。config验证固定账号、typed policy、资源和无externalActions；不能因allowLocalWrite获得网络发布。

`init` 只显式建立新空渠道库，添加manifest.requiredStores/schema/状态检查；已有profile通过带备份增量migration添加，不隐式建库。迁移计划包含旧状态hash、import记录、新库与必要回执；关闭插件仍保留既有库、unknown与水位。日常启动/recover不读取旧worker重新初始化，也不调用模型／平台写接口。

现Host协调按数据路径占用，**不足以阻止两个不同dataDir消费同一账号**。新渠道必须另取得固定公共资源键 `bilibili-owner:170759822:13461350` 的受信机器级consumer lease；对应共同anchor／coordination位置由部署绑定，不能由各profile任选路径躲开冲突。lease含owner instance、进程身份、nonce、generation与绑定hash，每次poll/派发复验。旧worker不认识新lease，故首次切换还必须验证旧入口确已暂停／停用。

切换顺序：guard无活动更新 → 阻止旧入站/新任务 → 等旧DM队列/active与QQ相关发送排空或封存unknown → 冻结服务器本地state/hash → 完成新库迁移与验证 → 获取唯一consumer归属 → 启动新Host（先hold ingress，恢复Core/渠道，再验证账号）→ 切换有效profile与guard健康归属 → 开放新入站。任何源文件／配置／state hash并发改变，停止切换并重取现状。

不能只关旧 Bili worker：实际 QQ 0.7.7 host 第147行也注册 Bili PRIVATE_TOOLS；Bili index 第885行还注册全局账号工具。新接管后这些旧发送入口都必须退出有效装配或通过明确的旧侧归属门禁失效，避免另一路 `bili_dm_send` 绕开新ledger。清理仅针对额外插件；官方DSH基础与独立SYSTEM update-guard保持。

新服务生命周期：`holdIngress/start/releaseIngress/quiesce/whenIdle/close`。quiesce阻止新poll/Task准入；已在途发送保留真实结果，超时取消可能出网的工作记unknown。Core的reply-ready／native accepted可在重启后继续既有交付，原模型／Task不能重跑；刚发生的source/pin/lease失效仍拦发送。健康给出真实账号验证状态、poll时间、pending/claimed/unknown、in-flight、delivery状态、lease generation和backoff，不含私信正文。

Guard按当前归属读真实新渠道/Host状态，不伪造旧heartbeat；old/new暂停后的fresh证据必须覆盖在途网络、模型和发送。归属切换记录及渠道数据位于代码回滚之外。回滚先停新入口并排空：若新消费者已接受或发送，不能恢复旧state备份让旧worker重放；需服务器内把新增seen、pending与unknown准确合并为旧侧可理解的状态并核验，做不到则保留渠道暂停、回滚代码而不回滚事实。不能两套同时运行，也不能让guard自动把旧工具重新启用后夺回账号。

## 8. 旧公开发布能力的明确差异

当前 A 第7行有评论／弹幕发布工具，旧DM允许PUBLIC_TOOLS；QQ现行host还引用 BiliHourlyCycle（快照未含其实现）。新项目公开Bili包目前是读取与观察，不自动继承旧发布能力。本首版保留DM回复与真实视频探索，**不新增自主评论、弹幕或旧hourly发布流程**；不把旧源中的提示词视为新授权。旧已发生的发布及未知回执仍保留。需要继续人工指示的公开发布时必须另立有来源、目标范围及幂等审查的typed能力；本方案不通过CLI、浏览器或任意HTTP补发，也不能借它绕过唯一私信对象。

## 9. 验收矩阵与放行阻断

| 范围 | 必须有的离线／受管证据 |
|---|---|
| pin/factory | 依赖缺失／hash轮换／路径别名拒绝；不执行旧apply/worker/persona/globaltools；生产不接受离线替身或JSON函数。 |
| 身份 | 错账号、主人换UID、第三人／自身消息、伪昵称／引用指令全部拒；凭据不进返回值、日志、模型或配置镜像。 |
| 入站／迁移 | >2^53精确ID、同ID异正文、重复分页、旧seen、未claimed queue、claimed unknown、精度旧版本、缺since、迁移中断均保留正确状态且不重复模型调用。 |
| Task | 真Bili mainText显式任务、兴趣goal分离、Bili↔QQ工具cross-origin互拒、控制版本／来源失效；server-executor即使被模型点名也无授权。 |
| 视频探索 | 真实Core+DSH脚本模型+虚构Bili/Media transport，执行只读Task、公共页/帧/音轨覆盖真实可查、目标人格整理＋验证＋固定DM交付；原Task正文不得直发。 |
| 出站 | 1000/1001 codepoint、emoji、trim规范化、空白/media、body冲突、派发前撤销、平台成功、本地回执失败、断链/取消、sent重放、unknown换ID均有独立断言。 |
| 恢复／排空 | ACK与Task结果分开持久；重启最多补各自一次，原Task/模型不重跑；已开始发送变unknown后不自动重试；反复恢复不重复发。 |
| Host/guard | 显式init／现有profile migration／关闭后保留；缺依赖释放占用；两个不同profile同账号抢占失败；guard暂停、切换失败及有新数据后的回滚不回退事实。 |

正式放行前仍须服务器侧核实完整transport依赖pins、被遮住的幂等实现、旧state/在途计数、实际账号登录、旧全部发送入口停用和唯一归属。无网络fixture通过不等于真实Bili验收；真实入站／回复核验使用现有唯一主人对象，不向第三人或公开区发测试内容。此设计未完成上述动作。
