# R6 旧渠道与夜间版本流程接管审查

日期：2026-10-26。范围：仅静态读取管理中心旧源码镜像及新项目接口；未连接服务器、运行应用／测试／Git，也未打开凭据、私人会话或原人格正文。本报告是 AI 代码审查，不是部署或真实渠道验收。

## 结论与证据边界

新 Host 不能在当前状态下直接替代全部旧渠道：B站主人私信入口、其人格依赖、历史归档及 23 点版本流程均需明确接管。旧 QQ 停用后夜间定时入口会消失；直接删除旧 QQ 代码目录还可能断开 B站的相对模块依赖。保留目录依赖也不代表保留旧插件的消费权。

本地 `自主更新保护开发/.../host-v072.mjs` 内版本是 **0.7.3-dafeiyu.1**，`调用限制解除开发` 的 QQ/Bili 分别为 **0.6.1-dafeiyu.1 / 0.3.2-dafeiyu.1**；它们不能代表主代理此前线上元数据核对的 **QQ 0.7.7-dafeiyu.1 / Bili 0.3.3**。v073 本地目录仅有 host 与 CLI 差异文件，不是完整依赖镜像。

后文 Q 指 [旧 v073 host 源码](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/自主更新保护开发/程序/qq-bridge-v073/lib/host-v072.mjs:1>)；B 指 [旧 Bili 插件入口](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/index.js:832>)。以下接口与行为必须先对照服务器现行公开源码，不能用本地文件覆盖线上版本。

## 1. B站独立主人私信的实际链

| 入口／模块 | 本地已确认行为 | 接管意义 |
|---|---|---|
| B `apply` 832–842 | `registerAccountTools(ctx)` 后启动 `startOwnerDmWorker(ctx, account)` | 整包加载同时注册旧工具并启动消费者，不能只为复用 transport 而装入新 Host／CLI。 |
| [dm-worker 83](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/dm-worker.mjs:83>) | 仅在 `DSH_HOME == root/运行状态/dsh-desktop` 启动；5 秒 tick，账号配置控制 autoReply | 该路径判断不是跨进程消费租约。独立 Host 不会因安装新公开读取插件而自动启动此入口。 |
| [dm-worker 29](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/dm-worker.mjs:29>) | 默认约 30 秒轮询；精确字符串消息 ID/seqno；分页读取，入站仅主人 UID；持久 seen/queue/since/accountUid | 要保留切换水位和账号校验，不能清空 state 后重扫旧私信。数字 ID 不得转 JS Number。 |
| [dm-worker 48](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/dm-worker.mjs:48>) | 模型前先持久 `claimed`；重启遇 claimed 记 `INTERRUPTED_DM_REQUIRES_REVIEW`，不自动重发 | 未知发送与已认领工作必须保留，不能把旧 claimed 当未处理重新执行。 |
| [dm-worker 17](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/dm-worker.mjs:17>) | 单独 session，官方 agents create/resume；本地旧实现限制工具为读取、公开发布及 notes，不给服务器 CLI | 新 Bili DM 要有独立 conversation/sender/account 来源，不能假扮 QQ owner Task 或获得管理员执行权限。 |
| [dm-worker 61](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/dm-worker.mjs:61>) | 等待完成的最终文字，长度 ≤1000，固定 `auto-<message-id>` 请求发送；成功审计后 observe 人格证据、flush session | 新渠道由 Core 人格会话产生最终答复并走可信 delivery；保留发送幂等回执，不把 executor 报告接到这里。 |
| [account 82](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/account.mjs:82>) | `readDm({before_seqno?,limit?})` 拒绝其他参数，过滤主人与独立账号双向消息 | 可以复用经线上核对的底层行为，但收件人不是模型参数。 |
| [account 94](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/account.mjs:94>) | `sendDm({text,request_id})` 固定主人；publish 先写 start，再写 done/error；无 done 的同请求被 held | 新发送端必须同时绑定原入站、目标、内容 hash 和当前许可；已有不确定尝试不换 ID 重试。 |

固定对象校验在 [auth.mjs 25](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/bili-lite/auth.mjs:25>)：公开配置 owner UID 必须匹配固定常量；运行时账号 UID/cookie 自身 UID/公开账号绑定一致才用凭据。会话文件由服务器端 auth 读取；适配接口只返回绑定状态或发送回执，不导出 cookies/session 对象。未调用任何登录或平台接口。

**直接依赖不能忽略：** dm-worker 第6行导入 `../qq-bridge/lib/persona-memory.mjs`，account 第4行导入 `../qq-bridge/lib/history-store.mjs`；它们不指向 v073 路径。必须读取线上 import 后确定真实依赖闭包。旧 worker dispose 只设 disposed 并解除等待，未提供可 await 的完整 drain/close；关闭 autoReply 也只挡新 tick，不能据此认定在途队列已排空。旧本地 worker 未接 `maintenancePaused`，线上是否补过须核验。

最小新接管接口（设计建议，尚未实现）：

- 固定 `OwnerBiliTransport`：`readOwnerPage(cursor)`、`sendOwnerReply({inboundId,requestId,textHash,text}, liveDeliveryPermit)`、`operationStatus(requestId)`；账号／主人／凭据位置由受信配置绑定，模型不传 receiver、cookie 或任意 URL。
- 独立渠道适配器只把真实平台入站交给 Core；保留原始 ID、时间和 sender 校验。输出只取此 conversation 的最终人格回复，经目标范围检查后调用 transport；不得复用旧 `registerAccountTools` 的全局工具继承。
- 生命周期提供 `pauseIngress / drain / snapshotMetadata / close / resume` 与单消费者租约。已发送、未派发和发送未知分别迁移；`claimed` 未知不推断失败或成功。凭据不搬到开发机，新旧消费者不能同时在线。

新项目 [BILI_ACTIONS](<D:/DSH/DSH workspace/dafeiyu/packages/bilibili/src/service.ts:18>) 只有公开读取及观察选择，没有 DM channel/send/comment-send/danmaku-send；[BILI_SCENE](<D:/DSH/DSH workspace/dafeiyu/packages/bilibili/src/config.ts:2>) 是 public/local。旧公开评论／弹幕能力也必须单独列入“保留或接管”结果，不能因换插件静默丢失；本报告不建议用 generic CLI补发。

## 2. 人格、用户记忆和历史的依赖

Q 第48–50行建立 PersonaMemory、SharedMemory 和维护队列；QQ 成功发送后 Q 第283行 `persona.observe`，Bili 成功回复后 dm-worker 第71行也写同一 `运行状态/qq-bridge/persona-evidence.json`。

[PersonaMemory](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/qq-bridge/lib/persona-memory.mjs:9>) 的输入为固定核心文件、可变偏好／近期关系文件和证据 JSON。`context(route,sender)` 按原 route/user/expiry 过滤关系；`commit(snapshot,batch,changes)` 校验文件 hash、事件来源与关系范围，随后直接改旧文本记录。它没有新 R1–R5 的 TrialOutcome／AdoptionReview 契约，不能继续把旧 commit 作为新人格采用后门。

[SharedMemory](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/qq-bridge/lib/shared-memory.mjs:29>) 是另一套 QQ 用户事实存储：候选保留 origin，长期事实按原会话读取，commit 拒绝跨会话合并，withdraw 同时更新候选／档案／索引。它与“人格偏好”不是同一种数据，也不等价于新 memory.sqlite。

最小兼容要求：先在服务器备份并列出新增数据的格式／范围／版本／删除状态；旧真实记录保留，必要的读取适配须带原来源和边界。迁入新人格时明确 `legacy-unclassified`，不能伪造 trial/adoption；未迁入的数据仍可受控回查。停止旧维护写端后才开新写端。不可复制旧固定核心或旧档案全文到新 system prompt，不恢复用户已清除历史，不把空新库解释成已迁移。

## 3. 23 点整理 → 日志 → Git 的最小代码链

Q `apply` 第514行的4秒 timer → `memoryTick` 第426行（guard pause / enabled / busy）→ 第454行 `nightly.tick()`。本次旧源码中的定时入口依赖 QQ，不能假设停用 QQ 后仍自动执行；线上是否另有独立调度仍待核对。

| 阶段 | 当前旧代码的可复用行为／必须保留的边界 |
|---|---|
| [NightlyCycle.tick 14](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/qq-bridge/lib/nightly-cycle.mjs:14>) | 读取 versioning.enabled/firstDay、memory.dailyHour/Minute；`dueDay` 用 UTC+8；日 cycle ID `daily-YYYY-MM-DD`。实际配置必须核对，不能只依默认23点判断。 |
| memory | 等 QQ active、旧CLI active、personaJob 空闲；`fullMemoryMaintenance()` 返回真实 complete。未完成存 memory_pending，30秒后再检查；完成后记录 memoryDone，再进入归档。 |
| archive | `archive.ingestSessions()` 后检查 lastError；失败不进入成功版本。旧 HistoryStore 只扫描固定 `dsh-desktop/dsh-cli/sessions` 的 `.jsonl.zstd`，新 Host 的独立路径／格式不能自动被覆盖。 |
| prepare/notes | `VersionManager.prepare()` 冻结相对基线的代码树、diff、archive watermark、维护结果及记忆快照；Q `writeVersionNotes` 第405行开独立官方DSH会话，只给 read_version_evidence/commit_version_notes。日志必须引用冻结 evidence refs。 |
| commit | [VersionManager.finish 78](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/qq-bridge/lib/version-manager.mjs:78>) 使用独立 Git index、commit-tree、带旧 HEAD 的 update-ref；HEAD 变化后拒绝覆盖并新 attempt。只有已记 committed 的版本对应 cycle complete。 |
| retry/idempotency | 已 complete 的同日 cycle 不再提交；失败保留状态，通常10分钟后重试；schema 有每 cycle 一个 committed 版本约束。手动 `manual-...` 和 daily cycle 不互相冒充。 |

Q `fullMemoryMaintenance` 第389行依次整理旧 persona 批次、旧用户候选，再检查 remaining 与活动任务；这不是新维护队列的已验证屏障。Q `writeVersionNotes` 第405行依赖旧人格文件与旧 agents/model selection，不能直接执行以“补上”新版本流程。

旧 [NightlyCycle 构造器](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/调用限制解除开发/程序/qq-bridge/lib/nightly-cycle.mjs:6>) 会调用 `manager.initialize()`；该方法可能 git init 并改本地 Git config。复用前须拆出“只打开既有仓库／schema”的入口，不能在接管启动时重跑初始化。旧 `protectedPath` 只排旧运行区、共享记忆库等；新 Host/executor 数据根必须纳入排除，且快照与代码回滚分开。

最小接管面可独立于 QQ：单一版本周期 owner/lease + `memoryBarrier(cycle)` + `archiveVisibleEvents(watermark)` + `prepareVersion(cycle)` + `authorNotes(frozenEvidence)` + `commitVersion(expectedHead)` + `status()`。保留旧 cycle/versions 的身份和水位，不重置数据库；新的 memoryBarrier 只依据新维护真实结果推进，不把旧 persona 直接写入当作新采用。日志作者使用受控官方 DSH 会话、同一实际预算端口与可见证据，不由 shell 拼出“模型已完成”记录。

归档继续保存可回查的来源与可见结果；新 source/run/operation/receipt 到旧 archive ref 的映射需显式设计。禁止扫描或输出内部思考、模型重放状态及凭据。旧历史的群聊查询只许 `route + audience=conversation`，快照和后台细节只供原主人私聊；迁移后仍保留此边界和删除／抑制规则。

本地 `调用限制解除开发` 与 `版本管理开发` 的 nightly-cycle/version-manager/history-store 三文件 SHA256逐一相同。这只加强本地线索一致性，不能证明线上未修改。

## 4. 线上公开源码读取白名单（后续由主代理执行）

以下均相对 **C:\DSH\DaFeiYu**。先检查实际 package main/exports、解析后的物理路径、文件大小和 SHA256；只读代码文本，拒绝指向凭据／运行数据／人格正文的链接。不存在的文件只记录 missing，不递归打包程序树。源码若误含硬编码秘密，脱敏并报文件位置，不复制值。

| 批次 | 精确路径／按 import 解析的受限补充 | 核对目标 |
|---|---|---|
| QQ入口 | `程序/qq-bridge-v073/package.json`、`程序/qq-bridge-v073/lib/host-v072.mjs`、`程序/qq-bridge-v073/cordis.patch.yml` | 当前版本、真实main、注册点、23点 timer/健康及dispose。若main已变，只追加package实际声明的本包源码文件。 |
| QQ依赖 | `程序/qq-bridge-v073/lib/{bridge-core-v072,persona-memory,shared-memory,nightly-cycle,version-manager,history-store}.mjs` | 主人/路由、可变数据路径、维护屏障、周期恢复和Git保护。仅当现行 import 指向 bridge-core.mjs 时追加那个确切文件。 |
| Bili | `程序/bili-lite/{package.json,index.js,cordis.patch.yml,dm-worker.mjs,account.mjs,auth.mjs}` | 0.3.3实际入口、是否已接guard、固定对象、幂等、凭据内用、旧QQ相对依赖。不读取login状态。 |
| 条件依赖 | **仅当Bili现行import仍引用它们**：`程序/qq-bridge/lib/{persona-memory,history-store,bridge-core}.mjs` | 确定“不能删”的代码依赖闭包；不启动旧QQ插件。 |
| Guard接口 | `程序/update-guard/{client.mjs,platform.mjs,engine.mjs,control.ps1}`；如改过入口，再读package实际main | 暂停／排空／恢复、健康聚合、桌面与新Host独立生命周期。守护本体不列入普通市场插件清理。 |
| 必要合同测试 | 上述包内现有 `account.test.mjs`、`lib/versioning.test.mjs`、`lib/persona-memory.test.mjs`、`lib/shared-memory.test.mjs`（存在才读） | 仅静态读场景与契约；不执行测试，不导入运行模块。 |

另需**只投影元数据**，不取整文件：layout的路径绑定；bridge的versioning开关/firstDay/时区小时分钟；bilibili的accountUid/ownerUid/autoReply开关/轮询间隔；有效desktop patch的模块注册和禁用状态。配置中的secret/env值不输出。

状态接管核验由服务器侧受信脚本完成，结果只给 schema/hash/计数/状态：DM是否busy/active、pending与claimed数量、ID精度版本和切换水位；人格证据pending数量／文件hash；history schema、cycle ID/state/阶段、version ID/commit/watermark、version.lock是否活跃。不要下载dm-worker queue正文、persona-evidence内容、session、history记录payload或人格文件。只读源码阶段不要构造旧 Host/NightlyCycle/BiliAccount 来“查看状态”，构造器／方法有写入或网络副作用。

## 5. 切换前不能省略的验证

1. 核对线上源码 import/版本与本地差异；逐个明确市场插件的保留、替换、移除及依赖闭包，证明官方基础插件与独立guard不受清理影响。
2. 验证 Bili入站与发送只有一个 owner，老请求未知状态不重放，新私聊保持固定主人、真实账号、独立人格和群聊隔离；公开发布能力要有明确保留/接管结论。
3. 排空旧人格维护写端，验证新增真实记录和撤回状态均保留，旧材料不自动获得新 adopted 资格。
4. 验证版本周期恢复沿用既有 ID/水位，23点记录对应实际触发；记忆未完成、archive失败、notes缺失、HEAD变化和在途写入都不能标complete。白天手动保存不能冒充当日晚间已完成。
5. 旧镜像的 Guard [platform.mjs 16](<D:/DSH/DSH workspace/蓝色大肥鱼管理中心/自主更新保护开发/程序/update-guard/platform.mjs:16>) 读取旧QQ/Bili heartbeat、桌面renderer、旧memory端口并统计versioning/DM忙碌；新Host不能只写同名假健康文件满足它。需要聚合真实新状态，覆盖暂停后的新入站、DM、模型、执行器和版本写入，回滚不覆盖新增数据。

本报告没有证明服务器当前代码与这些旧实现相同，也没有完成以上接管。对应功能在正式矩阵与部署放行前仍是独立验收项。
