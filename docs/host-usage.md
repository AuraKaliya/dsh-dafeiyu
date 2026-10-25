# 大肥鱼本地统一运行入口

本入口对应第一阶段1F，并已接入QQ文字／任务流程、记忆E和自主活动。支持统一检查、初始化、迁移、常驻启动、一次性原生任务和状态查询。1G完整评价、完整媒体和B站仍按后续阶段实施；此入口不自动部署服务器。

## 1. 先使用隔离的测试配置

在项目根目录运行，要求Node.js `>=24.13.0 <25`：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
node scripts/dafeiyu-host.mjs inspect --config profiles/host.test.json
```

[host.test.json](../profiles/host.test.json)使用固定脚本模型、虚构底色和独立的`.runtime/host-test/`。它验证程序，不代表真实大模型行为或真实生活经历。首次inspect返回`ready:false`和退出码2，表示需要显式初始化，不会自动创建业务库。

**仅对明确的新空目录运行一次init：**

```powershell
node scripts/dafeiyu-host.mjs init --config profiles/host.test.json
node scripts/dafeiyu-host.mjs inspect --config profiles/host.test.json
```

已有目录或失败初始化不会被init清空。已有业务数据走迁移流程，不把init放进日常启动脚本。

## 2. 执行一次本地任务

```powershell
node scripts/dafeiyu-host.mjs run --config profiles/host.test.json --request profiles/task.example.json
node scripts/dafeiyu-host.mjs status --config profiles/host.test.json
```

[请求样例](../profiles/task.example.json)只包含requestId、目标及受限策略选择；不能指定执行身份、授权句柄或任意来源。相同requestId和相同内容返回同一次运行的状态／结果；改目标时不要复用该requestId。既有Task的继续运行支持taskId、expectedVersion及允许的输入引用，TaskRef由Host签发。

run会独占profile，执行后关闭。它不启动QQ接收、旧聊天／任务积压或后台分析，也不会把内部结果自动发到聊天。运行完status显示`online:false`、`phase:stopped`是正常结果。

也可使用自动构建的仓库命令：

```powershell
npm.cmd run host -- run --config profiles/host.test.json --request profiles/task.example.json
```

安装工作区依赖并构建后，包同时提供`dafeiyu-host`命令；Windows本地命令位于`node_modules/.bin/dafeiyu-host.cmd`。

## 3. 常驻运行与关闭

```powershell
node scripts/dafeiyu-host.mjs start --config profiles/host.test.json
```

start保持运行，开放已配置渠道并处理已受理队列。另一终端可使用status；第二次start或run会因profile已占用而拒绝。Ctrl+C／SIGTERM先停止新工作，等待已运行任务和交付收尾；超过配置期限则合作式取消，再保存状态并关闭。

不要通过删除占用记录接管仍存活的实例。已退出进程的记录会在事务核验后回收；核心数据库仍保留自己的占用保护。默认协调文件位于当前系统用户的`.dafeiyu/host-coordination.sqlite`，不是私人记忆库。不同用户／服务账户间的服务器切换仍需单独部署验收。

实际Windows终端验收中，Host完成关闭，外层PowerShell会话因中断返回1；应用状态、存储占用和终端退出码分别记录，不能只凭外层退出码判断数据是否已排空。

## 4. 本机真实模型配置

[host.local.example.json](../profiles/host.local.example.json)使用本项目新建的[正式底色](../profiles/persona.foundation.md)，指向独立`.runtime/local-formal/`，默认不配置QQ。它引用当前用户既有DSH凭据服务中的`DEEPSEEK_API_KEY`；不复制凭据、不把密钥写入配置，也不采用管理中心旧人格或私人记忆。

按需要调整`model-deepseek.config.credentialStore`为本机既有凭据文件位置。inspect只进行离线检查，能指出文件缺失；引用是否可用、模型及推理档位是否支持在启动时核验。旧凭据格式不会被Host偷偷迁移。

确认路径后，按inspect→init（仅新空目录）→run／start的顺序操作。正式与测试运行应使用独立profile和数据目录；`persona.kind`标明底色用途，本身不证明库中的材料是真实经历，也不会自动筛除用户选错目录中的虚构材料。

若启用QQ适配，需要显式提供独立本机测试账号、主人ID、群范围、回环OneBot HTTP／WS地址、tokenFile以及`paths.channels.channel-qq`。Host不负责启动QQ登录程序或复制服务器登录态。[QQ配置样例](../profiles/host.qq.example.json)使用虚构ID和脚本模型，复制并填写实际本机测试设置后才可使用；本轮没有启动它连接QQ。真实模型和平台验收已延期。

2B已加入可配置自然称呼和群列表同步。旧配置默认 `naturalNames:[]`、`groupSync.enabled:false`，保留原at／引用和静态群范围；样例启用“大肥鱼”“蓝色大肥鱼”，只识别正文直接称呼，引用／昵称不作为称呼或主人授权。群同步默认每30秒刷新，allowlist模式取配置群与已加入群交集；joined模式必须明确开启，才能开放所有实际已加入群。失败可在120秒内沿用本进程最后成功集合，过期拒绝群操作；重启后需重新成功同步。Host状态保存同步状态、错误、有效群数量与上次成功时间；失败显示degraded，仍可提供已授权主人私聊。图片／语音／文件和新任务交付仍待后续步骤。

当前QQ目标库为v4，memory为v11。旧QQ v0—v3／memory v1—v10库普通启动会提示迁移，先按第6节流程备份升级；不能用init重建旧目录，也不能让旧二进制写升级后的库。群快照只记录账号绑定的成员范围，浏览短期快照也不等于长期记忆。

2C浏览能力需显式开启 `channel-qq.config.capabilities.enabled:true`，装配memory及来源追踪（`memory.config.sourceTracking:true`，或已有compaction），并为 `conversation` 策略配置producer `channel-qq`、三个动作 `qq_groups`／`qq_browse`／`qq_observe_select` 和 `allowLocalWrite:true`。缺项在连接前拒绝。样例已包含这些配置，未开启时沿用原QQ行为。来源追踪自身不会增加辅助模型调用。

聊天浏览只限当前实际会话；主人私聊不因此取得其它群的读取资格。`qq_groups`返回授权与平台范围的交集，`qq_browse`只读取本账号已接收／发送的本地缓存，`qq_observe_select`按实际页面选择不记忆、原文、Unicode片段或推断摘要。单页最多20条／8000字符；同页的requestId可重试，继续分页使用nextCursor并保持limit。快照默认1小时、最多256份，撤回、过期、重启后票据可能失效，应重新浏览。图片／音频／视频仍仅标明未读取。

开启能力后，新缓存按账号＋会话绑定；旧未绑定账号的缓存保留，但不自动交给新浏览动作。新收到的同账号事件建立新缓存，不用旧内容补造观察。原生Task只有策略显式列出的 `resources` 可读，贡献仅在Task内部使用，不自动发QQ。一次性 `run` 模式关闭QQ，因此忽略仅服务于未启动渠道的策略；若原生任务策略自身要求QQ动作，仍会拒绝不可用的动作。需要QQ原生任务浏览时使用已装配QQ的常驻Host及其可信程序入口，不能靠模型填写群号扩大授权。

Host状态的 `services.qq.capabilities` 表示动作已注册，`services.memory.sourceTracking` 表示来源追踪已配置；仍需结合QQ在线／同步状态判断可用范围。收到本账号撤回通知会使关联浏览来源失效，不额外唤醒模型；离线期间未收到的撤回不能保证追溯。详见[2C实现与检查](qq-phase2c3-integration.md)。

2D已将普通QQ文字回复接入持久分段：总正文最多32000、单段最多4000个UTF-16单元，优先换行并保留Unicode／CRLF，正文不加额外标题。状态 `services.qq.delivery` 显示计划数、未发送段数及未知段数；这与QQ在线状态分开。任何一段不确定都停止后续发送，重启不自动重发。部分发送在旧核心消息状态中保守显示uncertain；程序侧 `dafeiyuQQ.deliveryStatus(replyId)` 可只读查看每段回执和稳定错误码，包括关闭后读取，不能仅按一条最终回执猜测全部进度。`counters.delivered`计完整回复，`segmentsConfirmed`计确认段。

明确尚未发送的普通回复仍可由程序显式请求核心重试，会重新核验DSH持久来源，不重新调用模型。已部分发送或未知的消息不接受该普通重试；未知段必须保留待真实核验，不通过换ID重发。旧单回执继续视为完整发送。没有新增分段配置开关或任意目标发送工具。

### QQ任务与结果回报

2E任务流程需显式 `tasks.enabled:true`；旧配置默认关闭。样例已配置 `qq_task_submit`／`qq_task_status`／`qq_task_control`，以及producer为qq-tasks的独立执行策略qq-task。默认 `deliverResults:true`，可关闭自动回报而保留内部任务执行和状态查询。样例的静态脚本模型只用于配置／装配，不会自然理解任务并决定调用工具；完整行为在本机可编程脚本夹具中检查，真实模型行为仍待统一验收。

主人可使用“任务：整理当前群讨论”“请你整理当前群讨论”“帮我检查……”等直接指示；程序从主正文固定目标，引用或昵称不授予主人权限。普通聊天无需建Task。自发兴趣与明确任务分别记录，大肥鱼可提出自己的探索目标；状态不直接公开可能受其它历史影响的内部目标／理由。当前阶段探索的资源仅当前会话；明确主人任务还可使用profile中显式列出的资源。

需要调整时，当前主人在原会话明确说“取消任务”“修改任务：新目标”“确认继续任务：补充说明”，由模型选择实际任务／异议ID调用控制接口。expectedVersion使用返回的taskVersion。当前实现不把任意间接说法自动认作控制许可；有歧义时应继续讨论。普通新群聊天不取消任务。取消／改目标后旧结果失效，继续任务所依赖的补充消息被撤回也会失效。

任务完成或出现阻断异议后，核心另开干净的目标人格DSH会话，以memory核验的材料和当前可用阶段人格整理，再独立校验并分段发送。等待通知不表示任务完成；内部Run完成也不等于已送达。`services.qq.tasks`说明配置／注册状态，`services.taskDelivery`分别统计pending、sent、partial、uncertain与blocked；状态不包含正文。新交付通过独立deliverTaskResult契约，旧D3的模拟限制没有改变。

同一Run只创建一份结果交付；重复请求不会再次调用模型或重发。重启遇到ready会核验既有凭据后发送，sending保持uncertain，整理／校验途中中断保持interrupted。终态失败／未知不自动重试。最近已发结果仅在原会话按当前来源核验后提供最多1000码点节选，缓存只留任务结果占位；完整正文仍在已发送QQ消息和本地受控记录中，当前没有完整历史结果分页工具。

若需要读取其它会话，必须在可信配置的resources中声明，并满足QQ账号／群范围；这不等于可以把其它会话资料发到当前群。跨场景记忆的表达仍需要memory中已存在且版本匹配的表达策略，可通过tasks.expressionPolicy引用；此配置不会自动创建或扩大策略。

## 5. 配置与诊断

- 配置内路径相对配置文件解析；命令行文件参数相对当前目录解析。实际路径、目录别名及SQLite硬链接均参与互斥检查。
- agentId、数据路径、managed生命周期由Host统一提供，插件配置不得覆盖。配置只能选择允许清单中的已安装包，不能注入任意import路径。
- 模型路由显式配置；本进程DSH_HOME在加载DSH之前绑定到profile内部，不跟随桌面默认模型／数据路径。
- 状态快照位于core目录的`host-status.json`；它只保存元数据、时间、健康和计数。status还要核对PID、占用nonce、配置及更新时间，旧ready文件不能证明在线。
- 根配置`context.compactionInputTokens`或memory插件的完整compaction配置二选一。成长区域由`persona.growthRegion`控制，不能再在普通regions里重复定义。
- analysis、retrieval、compaction等未配置时明确显示；`configured`不等于已探测远端服务可用。activity、media和bilibili见下文。
- 新profile初始化不会写入底色模板或预设偏好；更换启动配置不会重置阶段人格。没有新增每轮调用次数上限。

退出码：0表示命令完成；1表示错误或任务失败；2表示检查未就绪、任务等待／中断或启动取消。status成功读取离线状态仍返回0，需查看`online`与状态字段。

## 6. 已有本地数据的迁移

迁移保持显式计划、备份、应用及核验，不并入start：

```powershell
node scripts/dafeiyu-host.mjs migrate plan --config path/to/host.json --backup-dir .runtime/migration-backups --out .runtime/migration-plan.json
node scripts/dafeiyu-host.mjs migrate apply --config path/to/host.json --plan .runtime/migration-plan.json
node scripts/dafeiyu-host.mjs migrate verify --config path/to/host.json --plan .runtime/migration-plan.json
```

命令会核对选定profile、实际路径、配置哈希和固定迁移计划。计划文件使用独占创建，不覆盖同名已有计划。活动Host占用的数据不能迁移；更换配置／路径后需要重新核对计划，不能套用另一profile的清单。

目标为journal v2、memory v11、runtime v4、QQ v5；旧D3及辅助权威库保持既有版本。memory v11追加经历、候选关系和整理队列；runtime v3追加独立任务结果交付账本，v4是语音来源／媒体协议的兼容门槛；QQ v5追加媒体来源及交付表。旧库需显式备份升级，既有Run、快照与文字回执保留。检索缓存按现有v2、DSH查询索引按v8核验；其它派生索引版本需另行明确升级／重建，start不暗中接受自动重置。旧会话由DSH管理，不作为模板导入新会话。统一Host的media插件装配仍待阶段5F，不因存在新库版本便宣称已配置媒体。

迁移中断保持准入关闭；新版本已产生新数据后，不用旧备份覆盖新增记忆。原`scripts/migrate-profile.mjs`仍可用，新入口复用其底层迁移实现。

## 7. 验收记录

- [1F-1配置／预检／初始化](phase1f1-profile-inspection.md)
- [1F-2装配／准入／关闭](phase1f2-managed-runtime.md)
- [1F-3命令／真实模型／终端验收](phase1f3-cli-acceptance.md)

这些记录不替代1G的162次完整人格与连续性评价，也不代表服务器资源和部署已验收。

## 8. 记忆E的按需整理

[host.memory.example.json](../profiles/host.memory.example.json)是隔离的本机脚本模型配置，启用`memory.config.sourceTracking`和`maintenance`。它用于装配检查；默认固定回复本身不会自主调用分析工具，不代表真实归纳质量。已有QQ profile可在memory配置中加`maintenance: {}`，并把需要的整理动作加入对应原生任务policy；聊天policy不因此获得跨任务正文权限。

任务中的操作和选材完成后，记忆保存当前task/epoch的整理请求。没有配置activity时，`services.memory.maintenance.scheduler`显示`not-configured`，请求为`waiting-scheduler`。不会因生成请求直接调用模型。按需整理在相同Task的获准Run中进行：先`dafeiyu_memory_maintenance_status`取得ID，再`dafeiyu_memory_consolidate`，然后读结果／经验。请求ID、taskId或模型参数不授予其它范围的访问权。

默认一次独立分析预算为120秒、输入64 KiB、输出32 KiB；Core Run仍有自身时间限制，实际取较先到达者。没有按工具调用次数终止。超限、失效、取消和模型失败保存状态，不自动重试；更正输入后申请新请求。没有已保留证据时仅记录活动事实，不凭任务完成推断爱好或知识。

`dafeiyu_experience_review`以expectedVersion追加复核记录。经验状态为accepted仍是有条件的经验，不是事实保证。`dafeiyu_memory_persona_candidate`只能明确选择proposed候选，后续试行／采用沿既有persona接口。经历修订保留旧推断作为历史输入；当前结果及人格依赖固定内容身份，旧建议不能静默变成新判断。撤下或来源变更立即阻断使用。

Host状态只展示整理状态／计数，不显示目标、经验正文或来源。关闭后保留最后计数。源库升级到v11不初始化历史人格、不扫描旧聊天补造经历。完整检查见[记忆E联合记录](memory-e4-integration.md)。

## 9. 自主活动与自动整理

[host.activity.example.json](../profiles/host.activity.example.json)启用可选activity插件及记忆调度，仍使用本机脚本模型与隔离目录。固定回复模型本身不会主动制定计划，实际工具选择与行为质量留待真实模型验收。规划工具为`dafeiyu_activity_plan/update/status`，只在获准原生Task中使用；QQ可先通过已实现的任务入口进入相应Task。

配置区分`activity-explore`与`activity-maintenance`策略，资源默认空。加入QQ／媒体／B站能力时需明确添加能力及资源范围；活动计划、来源引用或Task ID不授予额外权限。首版不自动把自主探索结果发到聊天。

daemon在统一ready后启动计时；single-run只装配和保存计划，不启动后台活动或投递积压。关闭先停新调度，再排空核心运行并保留回执。`services.activity`显示运行状态、计划／机会计数与稳定故障码；记忆调度桥连接时`services.memory.maintenance.scheduler`为`connected`，这与计时器是否运行是两件事。

默认每5秒轻量检查，最小全局唤醒间隔60秒、活动并发1、最多100个未结束计划、单次活动最多5分钟、每天1小时活动时间。它们是可配置的时间／容量约束，不是工具调用次数或费用预算。安静时段默认空，按IANA时区解释；周期按UTC经过时间计算。coalesce为默认错过政策，不补跑整夜每次积压。

有前台工作时合作暂停并按原权限检查点继续；未知效果阻断重放。达到单次时间预算时保留进度并等待重新规划，不伪装任务完成。计划改变会废止旧的排队／暂停机会，已开始的活动可在原权限下收尾。旧来源失效后隐藏旧目标，不能只切回active便复活它。

记忆自行判断待办：同Run且来源被完整覆盖的选材请求可合并；没有内容证据的请求只落定活动事实。有证据的整理通过同Task的maintenance Run执行，并保留原始经历动机。整理不会递归唤醒自己。

activity使用独立`core/activity.sqlite` v1，memory为v11；阶段4交付时runtime为v3，当前v4兼容门槛见第6节。已有profile首次启用activity必须走第6节显式迁移；迁移将备份旧库并追加新库，不以init替换数据。以后关闭插件仍保留其权威数据。插件只在进程存活时计时；系统启动、服务器守护和正式部署未在本阶段配置。详见[自主活动联合检查](activity-4d-integration.md)。

## 10. 统一媒体

`profiles/host.media.example.json`提供QQ媒体接收和文档读取模板。先将其中D盘工具占位路径替换为已经安装的FFmpeg／ffprobe和Python；文档PDF后端固定pypdf 6.10.0。Host预检只检查路径／配置，不自动安装或下载依赖。模板脚本模型仅用于装配，完整工具流程由测试夹具驱动。

启用视觉需配置`media.vision`的provider／model，当前Host支持与聊天相同的已装配provider，可选择其另一model；实际图像读取还要检查适配器声明image输入。音频需要`media.audio.whisper`与`events`分别配置既有本地运行库、模型／词表路径、版本和SHA256，字段见媒体方案及audioConfigSchema。单个后端缺失明确报告缺口，字幕不能代替音频。

QQ接收用`media.enabled`；发送另需`sendEnabled:true`并在对应策略加入`dafeiyu_media_reply`及`dafeiyu_media_reply_status`。缓存目录只列出实际平台缓存根；HTTPS取件主机逐个允许，不接受任意URL或重定向。直接主人语音任务需`voiceDirectives:true`、QQ tasks以及两个音频后端，仍以原消息主人和完整音轨证据为准。TTS通过`media.tts`配置固定本机System.Speech声音；它只合成核心批准的最终正文，质量留待真实验收。

首次在已有profile启用media，或media v1升v2，必须显式迁移。备份包括数据库、实际对象和正式分析会话的hash清单；处理中间目录不作为正式材料复制。停止时排空／取消媒体工作，重启仅据匹配的固定计划和回执对账；未知发送不重发。`services.media`显示计数和可用配置，不包含媒体正文；配置存在也不等于模型／平台已验收。详见[阶段检查](media-5f3-integration.md)。

## 11. B站首版

`profiles/host.bilibili.example.json`是完整结构模板，使用前需替换虚构账号、工具占位路径、全零权重hash和模型路由。默认匿名，独立本机会话可选；不复制服务器凭据。首次启用必须显式迁移到bilibili v1，关闭插件保留数据。插件不注册B站渠道或发布动作。

QQ明确任务、聊天兴趣和activity唤醒都调用同一B站能力；兴趣资源需要tasks.explorationResources和任务策略resources共同声明。启动没有任何活动计划时不会自动创建刷视频任务。音画、字幕、评论和弹幕分别举证；搜索词必须来自获准来源。状态services.bilibili只显示计数、媒体接线与退避，真正模态配置结合services.media判断。详细动作、支持格式、容量与尚未真实验收的限制见[B站使用说明](bili-usage.md)。
