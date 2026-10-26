# R6 服务器执行与 DSH 装配方案（待实施）

2026-10-26。本方案依据本项目源码、已安装的本地 DSH 包及管理中心历史镜像编制。当前校准继续完成；源码、脚本、测试保持冻结，本轮只修改本文。R6 完成后重新冻结候选并校准，正式 162 项不先运行。未连接服务器、读取凭据内容或实施部署，线上 ABI、账户、进程权限、任务、Git 差异及真实新增记忆均待核验。

用户最新澄清优先于此前“清空其它插件”的宽泛理解：只清理后来从市场额外下载／配置的插件；**DSH自身架构中的官方基础功能插件绝对不能动**。按实际inventory、来源与依赖闭包分类保留／替换／移除，不能按包名前缀猜测。独立SYSTEM update-guard属于运维保护，继续保留并适配，不作为普通市场插件清除。新大肥鱼插件按单独固定清单装配。

## 1. 已定架构与当前事实

保留服务器 DSH/Cordis、已安装 CLI 和独立 update-guard。新增受信 bootstrap 与 CLI 执行能力适配，不重写人格、记忆或模型循环；完整 CLI 声明为 external-write，不能伪装成 local-write。Core 只增加默认关闭、按扩展与动作精确授权的原生 Task 入口；普通会话、全局工具继承及任意插件导入继续关闭。

| 当前事实 | 代码依据与影响 |
|---|---|
| ManagedHost 没有通用文件／命令执行器 | host/runtime.ts 只装配 DSH 基础服务和列出的项目插件；configuration.ts 的 pluginSchemas 无 executor。dsh-tools 是注册表，不提供通用工具实现。 |
| 同进程已有工具也不会自动进入大肥鱼 | core/runtime.ts 与 native-runtime.ts 均 restrict({allow:[]})，再注册本轮 action。R6 保留此行为。 |
| 包可以作为 Cordis 插件装配 | Core/Memory/Timeline/QQ/Activity/Media/Bili 有 apply/inject；Core 使用既有 DSH Agent 与持久化，没有独立模型循环。 |
| 仅添加包名不能完成 managed 装配 | Core.configureExecution 要求 managed/registered；Memory 的 PersonaService、repository、native expression 及 QQ tasks/capabilities 依赖 managed 生命周期。 |
| 现有 Task 一律过滤 external-write | execution-coordinator.ts 原生和会话动作过滤均排除该 effects；须显式补最小 Task 准入。 |
| ManagedHost 没有生产扩展 factory 清单 | 它自行 new Context；onPhase 可在 binding 时同步注册，但没有完整异步装配、健康与释放契约，CLI JSON 也不能提供函数。 |
| 依赖版本需核实 | Core 等 peerDependencies 使用 Cordis 4.0.5、DSH 0.2.1-rc.2；当前服务器是否兼容未知，不能用旧镜像推定。 |

主路径为“现有 DSH 服务 → server-bootstrap → 新 Core/Memory/渠道/活动 + server-executor → 专用 headless 子进程”。bootstrap 是显式受信插件，注册固定能力，不加载用户／模型给出的任意模块。ManagedHost 留作现有本地运行及验收入口；若需要独立部署，再为同一 executor 增加固定 Host 插件枚举和装配，不作为 R6 主路径的前置重构。

## 2. R6a：最小 Core 契约与旧数据兼容

在 authorityPolicies 新增可选 externalActions；不使用 default([])、default(false)、prefault 或迁移回填。建议形状：

    externalActions?: readonly {
      extensionId: string;
      actionId: string;
      actionVersion: string;
    }[];

extensionId/actionId 沿现有命名 Schema，数组去重、有限容量、无通配符。部署 bootstrap 只允许显式列出 server-executor 的固定动作及版本。动作还须出现在同一 policy.actions；allowLocalWrite 不授予 external-write 权限。

原生 Task 可见性要求：scope.kind=task、action.requiresTask=true、effects=external-write，并同时匹配 actions 与 externalActions 的扩展 ID／动作 ID／版本。其余 read/local-write 规则不变。会话过滤与 conversationSnapshot 继续完全排除 external-write；即使配置错误列入 conversation，也拒绝配置或保持不可执行。authority、任务异议、操作幂等、未知副作用及取消检查沿现有 bindAction 路径。

默认兼容要求：

- 缺 externalActions 即拒绝外部写；旧配置解析后的对象不能凭空出现该键。显式空数组也拒绝，但其新 hash 不伪装成旧 hash。
- 不修改已有 Run definition/snapshot、authorityVersion、persona manifest、request payload、阶段人格正文或 hash。旧记录不补授权字段，不从历史主人消息自动推导新授权。
- 新授权产生新的 policy hash 与新 Run 的会话身份；既有未完成任务若不满足当前政策不得借恢复升级权限。先按原快照与版本校验，再重新受理合法的新工作。
- 不增加通用工具透传、任意 import、模型可设的 actor/owner/admin 参数，或 external-write 全局布尔开关。

为避免适配器直读 Core 私有数据库，增加仅程序可用的 authorizeExternalTask(context, pluginId)。它验证现有 WeakMap grant、动作实际 owner/effects、原生 Task、命名授权、当前 epoch/状态及来源，然后返回只读描述与 guard；复制描述不能产生授权，真正操作仍须持有活 context 并由 Core 复验。

描述最少包含：agent/task/run/operation/intentVersion、原始 goal、motivation、policy id/hash、action owner/id/version/pluginVersion，以及下列真实 origin 证明之一：

- owner-message：复用 validateMessageSource/validateMessageAncestors，核验当前 QQ binding、真实发送者、原指令/控制消息 hash、账号、目标及撤回状态。启用语音任务时沿既有 binding.voice.current 核验实际声源与固定转写目标；不能让模型输入文本充当语音证明。现有 explicitTaskInstruction 仅支持文字，保持其旧接口不变。
- activity-wake：复用当前 wake chain/provider 校验，返回 schedule/version/occurrence 与原 self-exploration 动机。continuation 必须能追溯到有效 origin，不凭字符串 kind 自封权限。

此 Core 描述只证明调用资格，不证明管理员 token 或实际执行结果。外部写判断集中为同一个 helper，避免“工具可见”和“调用授权”采用两套名单。

## 3. R6b：受信 bootstrap 与独立 standing authority

建议新增 packages/server-bootstrap 与 packages/server-executor；名称可在实施前统一，本文描述的接口不能因改名丢失。bootstrap 使用现有 DSH ctx 的 agents/sessions/sessionPersistence/tools/systemPrompt/llm，不重复装配一套全局 Agent、凭据服务或默认模型，不在旧 DSH 进程内启动 ManagedHost 自建 Context。

启动顺序沿现有公开接口：独立路径预检及占用 → Core(managed) → Timeline → Memory(managed) → configureExecution → executor/Activity/Media/Bili/QQ(managed) → 暂缓 QQ 入站 → Memory 就绪 → recoverExecutions（含 TrialOutcome 补齐）→ core.recover → activate(deferWork) → 渠道就绪 → 开放准入 → Activity.start。关闭先停新唤醒/新子任务/新入站，再排空或取消，最后逆序释放。失败不能遗留第二个消费者或删除其它实例占用。

bootstrap 必须具有自己可观测的 ready/degraded/draining/stopped 状态，纳入 guard 的空闲与健康判定。包通过固定 DSH bundle/patch 安装；兼容现有 ABI 失败就停止该候选，不自动替换服务器整个 DSH 或强行安装另一套重复 peer 服务。

standing authority 是部署维护者写入的版本化授权文件/记录，不由模型生成。建议最少字段：

    schemaVersion, id, version, agentId,
    producers, policyIds, actionIds, purpose,
    effectiveAt, expiresAt | null, revoked,
    allowedWorkRoots, budgetAuthorizationId, maxExecutionMs

授权 hash 绑定实际配置；每次 dispatch、子工具执行及结果返回重验现状。部署政策明确开放给 activity 的 self-exploration，maintenance/mixed/unknown 默认不借用。自主计划与 wake 仍需原有 anchor/occurrence 验证，standing authority 不替代它们，也不伪造 owner-message。

聊天产生的自主探索若需同样执行能力，应明确作为独立的 standing-authority 分支核验真实 self-exploration Task；不因与主人任务共用 qq-task policy 就自动取得 owner 权限。首版可只开放已验证 activity wake，但必须在配置与报告说明其它自主入口尚未启用，不宣称已全部覆盖。

## 4. R6c：CLI 适配接口与实际权限

建议注册固定 V3 动作：

| 动作 | 声明与用途 |
|---|---|
| dafeiyu_server_execute_owner | external-write、requiresTask；仅真实 owner-message 原生任务，输入 requestId、当前任务内的执行步骤及已曝光材料键。 |
| dafeiyu_server_execute_autonomous | external-write、requiresTask；有效自主 origin + standing authority，不冒用主人。 |
| dafeiyu_server_execution_status | read、requiresTask；只读当前授权 scope 的 job/receipt，不凭 jobId跨任务读取。 |
| dafeiyu_server_execution_result | read、requiresTask；分页打开已封存可见结果并产生合法来源引用，不能重新执行。 |

初版 execute 在受限时间内等待真实 child 终态后返回；不先返回“accepted”便让外层 Task 当作完成。需要跨父 Run 的长期后台工作不顺带实现：超时/暂停按真实状态收尾并保留证据，后续基于当前任务控制接口明确继续。status/result 可回查已封存结果；未知状态不提供模型可调用的“确认已成功”或“强行重试”开关。

模型不能指定 CLI/Node路径、profile、权限模式、env、owner、身份或 grant。父进程从受信配置取固定绝对路径及文件/配置 hash，以参数数组和 stdin 传业务材料，工作目录明确。原始任务目标、权限来源与第三方材料分开传递；模型的子步骤不改变原授权。

实际管理员身份必须由进程侧证据验证：父进程 Windows SID/token、提升状态、子进程继承后的 SID/提升状态与进程创建身份；验证器为固定受信程序，不能让模型回答 whoami 自证。DSH_PERMISSION_MODE=danger-full-access 只是 DSH 执行模式，不能证明 OS 管理员权限。若服务器启动账户/token 不匹配，executor 关闭并报明确错误，不静默降权后声称完整能力。

适配器使用专用 headless profile，保留已核实的 DSH 通用文件/命令工具与安全候选更新工具。该 profile **不装 QQ/Bili 发送、私信或公开发布工具**，不装旧 qq_task_attach_file 自动交付旁路；父进程使用环境白名单，不展开整个 process.env，不注入 QQ token、Bili cookie/会话路径或其它平台凭据。模型凭据只由服务器受信凭据服务/桥提供，不进入提示词、日志、Git或本地工作区。

这不会给通用 CLI 新增 B站公开发布或私信授权，既有固定对象与平台限制继续适用。管理员 CLI 不是 OS 沙箱：它仍可能读到同账户可访问文件并执行通用网络代码；“未加载发送工具/未注入凭据”不等于不可绕过的物理隔离。R6 不建设新全面 OS 沙箱，也不声称提示词能绝对隔离；如果实际需求要求此种强保证，必须先补独立边界，不能把该未实现保证写进验收结论。现阶段可承诺的是明确授权、固定 profile、入口校验、无新增平台权限、可取消与可追溯。

## 5. 子进程、grant、持久化与恢复

executor 独立使用运行数据区的 executor.sqlite v1，不改 memory v12 或旧 Core 表。建议表：

- executor_jobs：id 主键；agent/task/intentVersion/requestId 唯一；指纹、状态、authority/profile/command hash、原目标 hash、创建/结束时间及结果引用。
- executor_job_operations：operationId 主键关联 jobId，绑定实际 Run 和请求指纹；重复操作不能创建另一个 child。
- executor_events：追加事件，记录 prepared/launching/handshake/tool/result/cancel/terminal 等白名单事实及 hash。
- executor_receipts：每 job 一份不可变终态回执，保存 child session、PID+创建时间+启动 nonce、退出码、可见输出 hash、工具效果与缺口；不保存凭据/内部思考。
- executor_budget_links：job/session/call/reservation 关联和结算状态，唯一键防重复结算。真实总预算仍由独立预算端口拥有。

首次启用executor须显式初始化空的新存储，已有profile走带备份的增量启用；普通启动不暗中创建权威库。预检／备份清单必须覆盖executor.sqlite、不可变结果归档与必要子会话清单，关闭插件仍保留记录。此库及budget_links只存执行事实和父预算回执关联，不另建子预算权威账本，不复制旧7C材料到生产。

状态按 prepared→launching→running→completed/failed/cancelled/unknown 追加推进。spawn 前持久记录 launching；child 启动后必须回传绑定 job/nonce/profile hash 的握手才开放任务。只有 prepared 且能够证明从未派发的工作可以标为未执行；launching 崩溃窗口不能推断“没启动”。

父 Core grant 生命周期限于本次动作，不能序列化给 child 作为永久权限。父适配器保留活 context，向 child 的受信插件提供可撤销的短期调用许可；每次模型派发和工具执行前经父端 guard 核验任务、来源、standing authority、预算及 profile。父端定期检查正在执行的 job；失效/取消/断链停止新动作并合作取消当前动作。已发生的写入不能撤销成 effects:none。

首版选择固定程序协议的本机 IPC broker（例如 Windows named pipe），以每 job 不暴露给模型的 nonce 绑定 child；协议只接收固定类型和有界数据，不接收执行代码。IPC 令牌不是平台凭据，也不是面对 Administrator 任意代码的安全沙箱。失去父连接即禁止新模型/工具派发并请求 child 收尾。

终止子进程树前核对 PID、创建时间及程序身份，避免 PID 复用误杀。沿用 DSH 工具取消与受控进程树终止；不能保证所有脱离跟踪的外部操作都被撤销。无法确认终止或副作用的工作保持 unknown，阻断同执行授权/profile自动再派发，保存待程序事实核对的记录。

恢复只读账本、child状态和已封存回执，不调用模型、不重放 CLI：

- 有完整已封存 receipt：回查同一结果；父 Core 仍按自身历史状态处理，不偷偷把旧 failed/unknown Run改成completed。
- child仍可核验存活：纳入受控收尾/取消；不凭 PID重附成另一次执行，也不在失去活 Core grant后继续新写入。
- 启动/结束不明确：unknown，保留可能副作用。只允许事实核对，不能由模型一句“已完成”解除。
- 同 requestId+同指纹返回同 job；不同指纹冲突。仅更换 requestId不能绕过未决 job 锁。
- Core 已有 unknown 操作门槛不降低。首版不承诺自动跨进程两阶段提交；若真实证据无法消除歧义，保留阻断并据实际状态另作受信恢复决策。

## 6. R6d：预算与 usage 观测端口

旧 task-budget 只记录 calls、limit:null，Host.onModelCall 也只有开始/完成计数；两者都不能证明费用受控。不得恢复每轮工具调用次数上限来替代费用预算。

费用支线只读核实本机DSH/headless 0.2.1-rc.2：headless --json 的 step_end.usage按step合计重试，任一attempt缺usage时整步省略，缺provider/model，projectJsonRun只订阅rootAgent session。该汇总不能作逐调用准入或全量账单，也不能推定服务器版本相同。新child计费插件须直接在实际llm/stream派发边界取得许可与usage，覆盖辅助会话。JSON流可能含thinking；父端按白名单解析后丢弃该类，不保存原始stdout/stderr、原始整行备份或未分类异常文本。

新增程序注入的 ExecutionBudgetPort；未配置预算/观测能力时不开放新 executor 的付费调用。建议接口语义：

    reserve({authorizationId, jobId, callId, provider, model,
             requestHash, sessionHash, inputBound, outputBound, deadline})
      -> {reservationId, dispatchPermit}
    settle({reservationId, callId, usage | null, finish, durationMs})
    status(authorizationId) -> remaining / held / expired

callId 由受信派发插件产生，reserve 原子检查额度、有效期、累计时间与路由，派发前完成；settle 幂等。子进程在 llm/stream 中观测真实 usage/cache/reasoning/finish，结构校验沿用本项目 billing.ts 已有语义。请求仅记录 hash与界限，不收集内部思考。必须覆盖子任务、摘要、辅助模型及错误路径；隐藏重试若不能逐次观测和预留，关闭该重试或拒绝启用该路由。

当前 R6真实验证适配唯一 7C账本及已批准保守计费规则，保留所有历史、实际费用未知标记与原到期，不重建账本、不自动加额；主体模型与子CLI共同占用，单协调者统一派发/结算。生产运行的预算授权另以实际部署配置绑定，不能把测试余额无声变成永久运营额度。

child 的预算 IPC 失败必须在 next()前阻止新请求；已经派发却无合法usage，按适用授权保留全部上界，不退款、不报零。父进程死亡后残留reservation及child事件要可对账；缺失结算保守占用。批准时间/费用约束不是固定调用次数限制。

同时提供只读 job/model 调用元数据、费用未知数、最近稳定错误码和在途数量，供 bootstrap/guard 判断空闲。不得将 secret-bearing stderr、环境变量或整段 private prompt写入健康文件。

## 7. 结果、来源、人格与更新守护

完整CLI退出只证明子会话的运行终态，不证明业务每一步成功。适配器分别记录：实际进程事件、工具调用/结果、模型 final与缺口；模型 final保持自述性质。实际工具回执可作为“执行了该工具”的观察依据，不能直接升级为现实效果或长期人格事实。

ActionOutcome在未派发拒绝时为 failed/effects:none；已派发后按真实收尾及工具回执给出 confirmed/unknown。取消不代表回滚；非零退出也不能一律称没有效果。输出超过动作上限时保存受控归档与分页引用，返回partial/coverage缺口。

结果进入当前Task合法执行来源，继承原始输入/任务/authority依赖；final和派生摘要不新增独立根。新人格状态仍只能走 R1—R5 的试行、采用评审与发布门槛，executor无写人格表的旁路。

QQ结果一律走新 NativeTaskDelivery：原任务完成/等待状态→memory目标范围核验→目标人格DSH会话整理→独立忠实性检查→分段/附件发送及回执。不得调用旧 ServerTasks.deliver()、旧bridge.dispatch()或直接上传文件绕过该链；当前自主wake没有授权目标时保留内部结果，不顺带发送QQ。

独立guard继续保留。CLI更新工具只调用 prepare/submit/status/history，编辑隔离候选，不能直接替换在线代码。bootstrap纳入guard空闲/健康检查；候选检查增加新TS受管验证入口，不能只靠旧validator扫描.test.mjs。守护维护在确认无活动更新后走独立维护流程，正常候选不覆盖guard/maintenance本体。

## 8. R6e：实施范围、测试与冻结顺序

| 子阶段 | 最小交付 | 定向验证 |
|---|---|---|
| R6a | contracts/host-config可选命名授权；Core native过滤与程序授权接口 | 默认拒绝、精确owner/action/version、会话拒绝、旧policy/Run/hash不变、伪grant、原消息/voice/wake失效。 |
| R6b | 受信bootstrap、固定profile与standing-authority读取/撤销 | 真DSH/Cordis装配、managed启动/排空、重复实例拒绝、依赖缺失关闭、无旧工具自动继承。 |
| R6c | executor插件、独立账本、固定child transport及取消/恢复 | 真实本机无网络child、实际文件读写、启动前后故障、PID复用防误杀、幂等、未知不重放、权限验证。 |
| R6d | 预算IPC与子模型观测插件、来源/归档/分页 | 脚本后端预留/usage/取消/断链/摘要覆盖、重复结算、未知全上界、无密钥和内部思考输出。 |
| R6e | 新persona回报与guard装配联合检查、发布材料 | executor报告不直发、撤回阻断、附件目标限制、更新候选流程、恢复不调用模型、真实记忆保护。 |

优先新增 executor-policy、server-executor、server-bootstrap、server-executor-budget、server-executor-delivery 专属测试；复用 core-execution、host、QQ-task-delivery、activity、persona相关受影响文件。测试名在实现时固定。全部离线开发测试由主协调者通过 npm test受管入口单次构建，临时数据在D盘.runtime/tests；模拟模型不宣称真实管理员、真实平台或语义验收。

真实本机进程验证使用明确的受管测试目录和无敏感文件，不借当前本机用户权限宣称服务器权限。部署前服务器仅做实际授权的身份/工具/ABI与受控工作目录核验，再进行有限集成；不用真实账号公开发测试评论/弹幕，不复制服务器登录态到本地。

R6各小阶段记录实际检查并提交后，再冻结新源码/依赖/专用CLI profile/授权Schema/工具集合/模型与计费路由。重新校准并评估所有受影响B/H；正式162在此后按同一候选执行。当前运行中的校准保留其原候选身份，不改成R6已验收。

## 9. 正式服务器核对与切换门槛

必要只读清单：实际DSH/Node/插件版本和ABI、desktop/headless有效profile、既有CLI路径/工具、Windows计划任务身份/token、当前账号和主人绑定、guard活动状态与稳定指针、Git差异、layout及真实新增数据路径、在途任务/发送与消费者。只输出元数据和脱敏差异；凭据由服务器程序使用，不打印或复制。

插件inventory至少记录实际包名／版本／安装路径及hash、安装来源／官方发行或市场记录、启用的bundle/patch、直接依赖与反向依赖、数据目录、分类证据、拟动作和回退材料。分类以实际官方发行清单、有效基础bundle及依赖图交叉核验，不以@deepseek-ai前缀、所在node_modules目录或“第三方”字样单独裁决。

| 类别 | 本轮处置 |
|---|---|
| DSH官方基础架构／基础功能插件 | 原样保留，不删除、不禁用、不升级、不用新大肥鱼替换；ABI不兼容时适配新插件或暂停受影响接入，不在R6中改动DSH基础。 |
| 基础功能与新大肥鱼必需依赖闭包 | 保留必要版本与链接；移除一个额外插件不能连带卸载仍被基础／新大肥鱼使用的包。 |
| 后来从市场额外下载／额外配置插件 | 在证明不属于上述闭包后，按明确清单解除注册／依赖，再在候选中移除相应代码；不删除其真实新增数据或凭据。 |
| 旧QQ／Bili额外插件 | 先记录在途工作与交付、准备新接管，排空并验证单一消费者后才停用／移除；未接管功能不能静默丢失。 |
| 独立SYSTEM update-guard及运维保护 | 保护保留并适配新bootstrap/测试/健康，走独立维护流程，不当成普通市场插件清空。 |
| 来源或依赖关系未明 | 标为待核验，阻止相关清理动作；先补证据，不猜测后删除。 |

清理清单包含实际注册点及依赖边的前后差异，纳入候选验证；候选不得包含DSH基础文件改动，完成后核对基础版本/hash和功能清单不变、必需依赖可解析、额外插件实际不再加载。旧账号／真实新增记忆／会话／凭据与代码分别保护，不重跑旧初始化。此分类规则同时适用于桌面与专用headless profile，不是把整个DSH profile清空后重装。

本地旧 executor参考为管理中心 自主更新保护开发/程序/qq-bridge-v073/lib/cli-server-tasks.mjs 和 host-v072.mjs：旧requireOwner在bridge端，start内部不核owner且前缀写死主人消息；旧CLI spawn继承父token；旧deliver同时处理人格回报与附件。它提供复用线索，不是可直接上线的完整权威镜像。专用profile必须从线上现状核对后形成合并候选，不能照搬旧headless包集合（其中有bili-lite和旧附件工具）。

新旧QQ/B站入站和任务回报必须明确唯一所有者；不能让两个bridge同时消费同一账号。旧B站私信、历史/23点版本流程分别列出保留或适配结果，不因新Bili包只读而静默删除功能。现有账号、重置后新增真实记忆和关系均保护；不重跑Cutover/Finalize等一次性脚本，不恢复已删除历史，也不把初始化解释为清空新数据。

新代码放版本目录；core/memory/session/query/channel/media/executor账本位于程序树之外。更新guard捕获程序树，不能让示例相对.runtime把真实数据纳入代码回滚。代码回滚与数据恢复分别验证，新写入后不能用旧备份覆盖新增事实。

不可承诺/不可放行项：未知服务器ABI、未验证管理员token、无法观测或预留的子模型调用、未决外部副作用、双消费者、旁路直接发送、只靠提示词宣称管理员CLI绝对隔离、旧镜像覆盖新代码/记忆。任何一项未解决，保持对应能力关闭并如实报告，不用人格矩阵通过抵消。

## 10. 本地证据入口

- 本项目：packages/host/src/{runtime,configuration}.ts；packages/contracts/src/{host-config,execution,message-task}.ts；packages/core/src/{index,runtime,native-runtime,execution-coordinator,registry-v3,agent-session}.ts；packages/activity/src/scheduler.ts；packages/memory/src/index.ts；scripts/evaluation/billing.ts。
- 管理中心历史材料：自主更新保护开发/程序/qq-bridge-v073/lib/{cli-server-tasks,host-v072}.mjs；同镜像配置文件/dsh-cli-profiles/headless/；程序/update-guard/{client,tools,platform,files,validate}.mjs及control.ps1；调用限制解除开发/程序/task-budget/index.js。
- 已读取检查记录/2026-10-23-插件自主更新保护验收.txt。运维/Invoke-Server.ps1与Inspect-Server.ps1仅作为未来受控入口参考，未调用。执行授权与数据保护按[本轮约定](autonomous-remediation-deployment-20261026.md)。
