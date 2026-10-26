# R6f-5 更新守护接管设计

2026-10-27。**本文件仅为设计审阅，没有修改或运行守护，没有连接服务器、执行测试、调用模型或进行 Git 操作。** 接续已提交的 [R6f 细案](../server-runtime-r6f-plan.md)，保留独立 SYSTEM `DaFeiYu-UpdateGuard`、原更新历史和自动候选流程；普通更新不增加真人逐项审批。

## 1. 本次证据与明确限制

有效依据为 `.runtime/deployment/server-update-guard-metadata-20261027-valid.json`，观测时间 `2026-10-27T00:58:17.9810817+08:00`：13 个公开文件的原始 SHA256 与管理中心 `自主更新保护开发/程序/update-guard/` 一致。因此下列静态结论适用于所观测版本。先前无 BOM 的 PS5 路径探针是无效材料，其 missing 结果不能解释为线上文件缺失。

该报告明确 `activeUpdateChecked:false`，没有打开守护数据库或读取私有数据；不能据此断言当前无活动更新。13 项也未覆盖 `vendor/yaml` 的完整依赖，正式替换／重新打包前仍须补齐公开依赖 pins。2026-10-23 的坏注册拒绝、启动故障回滚、自主提交成功是既有历史证据，不是新 Host 验收。

| 已确认代码 | 现在的行为与接管缺口 |
|---|---|
| `update-guard/platform.mjs:15`、`control.ps1:4` | 健康绑定旧 QQ/Bili heartbeat、桌面 renderer、6190/6191 旧服务；Stop 按 Desktop.exe 路径强停桌面。不能据此判断或控制独立 ManagedHost。 |
| `engine.mjs:51/63/77` | waiting_idle 依旧 heartbeat 的 pauseAt；验证只有 healthy/失败/超时，预算正常停止可能被误判为候选故障并回滚。 |
| `client.mjs:7` | maintenancePaused 只读30秒内 health 的部分阶段，失去心跳就返回 false；不是更新与夜间写入的互斥凭据。 |
| `files.mjs:5-8/26` | 广泛捕获 `程序/`、两个旧 profile 及链接闭包；只有 guard/maintenance 被固定保护。新增数据目录及官方基础依赖不能自动沿用这个范围。 |
| `validate.mjs:27/31/62` | 基于旧 profile/bundle 要求 guard 工具；部分包按名称前缀豁免；仅发现 `.test.mjs`，不能覆盖新 TypeScript、固定 Host/CLI 装配。 |
| `packages/host/src/status.ts`、`coordination.ts` | status 校验配置、心跳、PID 与所有者；协调库默认依赖 homedir。SYSTEM 与 Administrator 的默认位置不同，必须显式绑定同一受保护路径。 |
| `packages/server-runtime/src/cli.ts`、`operations-authority.ts` | 预算停止已触发取消／排空并输出 production-stopped，但缺专用持久停止回执。正常运行时 funding lease 为 active，inspect 可能返回 FUNDING_LEASE_OWNED；不能把 status 的退出码2等同进程坏了。 |
| `packages/host/src/runtime.ts:206`、`packages/contracts/src/lifecycle.ts` | close/quiesce 属终止流程，不能随后 activate 假装恢复。当前缺少夜间周期与更新共用的可恢复维护窗口。 |
| `packages/server-executor/src/headless-manifest.ts:11` | 专用 CLI 的工具枚举只有 read/write/edit/pwsh，四个 update 工具尚未装入；旧桌面 profile 有 guard bundle 不代表新 CLI 已继承。 |

## 2. 采用独立 Host 目标，保留桌面基础

守护增加固定 `managed-host` 平台适配，保留旧 `desktop` 适配用于明确的独立桌面维护；每个更新 job 固化 target、release 清单、launch manifest hash、前一 stableId 和 handover generation，不能按“哪个健康文件存在”猜目标。普通新大肥鱼候选只重启其 Host 及已归属的 executor 子进程；不停止桌面、不卸载官方 DSH 基础服务。

桌面基础包、必要依赖、profile 中基础注册和 SYSTEM guard 按实际 inventory/来源/依赖闭包建立保护清单；不再用 `@deepseek-ai/` 等前缀代替分类。旧 QQ/Bili/夜间入口仅在交接排空后解除其消费者／写者资格；保留仍被引用的兼容代码与真实数据。候选回滚不得恢复那些旧消费入口。

新增受保护的公开运维绑定记录，给 guard/launcher 共用固定 Node、任务名、launch manifest、Host status、coordination、维护协调库和 releaseRoot 路径。它由部署程序写入，不能由工具参数选择根、进程、模块或命令。Host 用现有 `HostRuntimeOptions.coordination`，status 用 `readHostStatus(config, coordination)`；路径放在 SYSTEM/Administrators 共用的运维区，不能让双方各用 homedir 默认值。

## 3. 真实健康、停止与预算状态

建议新增严格的 `RuntimeOperationalSnapshot`，由固定 launcher 写原子快照，并通过本机受保护控制端口提供同一投影。只含元数据：instance/boot ID、PID与creationId、实际 Node/SID/提权证明摘要、launch/config/release hash、启动时间、Host原状态、模型在途及预留数、executor/渠道在途数、维护 token、停止原因与回执 hash。不得含会话、工具正文、凭据或思考。

`ManagedHostPlatform.probe({since, expectedRelease})` 必须同时核验当前进程身份、显式 coordination owner、固定 launch pins、该次启动的 boot receipt 及新鲜 Host 快照。Host 当前只有 config/foundation hash，须补 launcher 的实际加载 release/manifest 关联，防止旧进程碰巧读取了新文件就被算作新版本。快照文件与 nonce 本身不代替 OS 身份／ACL。

| 判定 | 条件与守护动作 |
|---|---|
| `ready` | 正确新实例，真实 required 插件就绪；QQ 连接与实际群同步、Bili 固定账号/lease/pins与实际验证、Memory来源跟踪、预算挂载和executor端口均符合配置。旧 renderer 心跳不能替代这些事实。 |
| `maintenance-held` | 有当前维护 token，业务新准入关闭，服务仍在；只为同 token 的受信维护工作开放所需端口。不能报普通 accepting=true。 |
| `halted-funding` | 持久资金原因可复验，已停止新准入，Host/子进程/费用结算排空已确认，实际进程已退出；不是在线健康，也不是代码故障。守护保留稳定指针并停止自动重启循环。 |
| `attention-required` | 未知费用、退出／结算未证实、账号变更、schema不兼容、来源／进程身份冲突。保留未知事实，拒绝据“PID不存在”或旧 health 清空占用。 |
| `failed` | 本次候选实际启动错误、装配/pins/schema/必要服务失败，且不属于已证明的预算或维护暂停。按兼容性边界处理代码回滚。 |

`FUNDING_EXHAUSTED`、`FUNDING_EXPIRED`、`FUNDING_UNKNOWN_COST` 和时钟/账本异常分别保留真实原因；reservedCalls>0 的暂时占用不是永久耗尽。资金 unknown 可形成稳定停止，但仍需要核对，不能改成余额0或成功结算。守护只读既有资金授权链、receipt及余额，不初始化、续期、加钱或创建替代窗口。

launcher 在真正排空/释放完成后持久 `RuntimeStopReceipt`：关联该 boot/release/资金授权、停止原因、Host与预算最终快照 hash、子进程退出证据、未决项统计。单条 stdout 或先于 finally 的“stopped”消息不构成回执。若排空失败，记录未确认状态而不写 drained=true；不释放仍有在途结算的 lease。

候选开始前已无预算则留在等待条件，允许离线自检，不切换到无法完成验证的版本。验证期间预算终止，进入持久 `verification_suspended`（保存原阶段和已取得证据），不把停止当健康、不因180秒超时自动来回重启；获得真正有效的既有/追加授权后重新连续验证。未知费用、账号变更等不能由普通重试自动解除。仍保留180秒启动观察、连续30秒健康的原语义，暂停时间不伪造连续健康。

新 `control.ps1` 分清 HostStart/HostStop 与旧 DesktopStart/DesktopStop。HostStop 先请求当前 boot 的受控排空，等待停止回执、资源归属释放和已记录父/子进程退出；不能只杀所有 node.exe。当前 Windows executor 不保证完整进程树隔离，不能把一条 kill 回执称作全部后代已消失；未证实则阻止文件切换并报告具体阻断。

## 4. 更新与23点维护共用真实窗口

新增固定路径的运维协调库／受信端口，更新 daemon 与夜间服务竞争同一个资源。记录 `{token,kind,requestId,ownerProcess,bootId,generation,state}`，以短事务 CAS 获取和释放；不用心跳过期就抢锁。进程消失但阶段不明确时按对应持久 job/cycle 证据恢复，不能直接抹除。旧 nightly/history 写入口先停用，才能声称单写者。

Host 增加 `beginMaintenance(request)`、`maintenanceStatus(token)`、`endMaintenance(token)` 程序接口；Core 增加可恢复准入 hold，而非复用终止型 ServiceGate.quiesce。令牌绑定当前 boot/代际/用途；关闭新入站、自主wake、新Task、新executor job和非本窗口后台维护；在途工作继续闭合。QQ/Bili已有 holdIngress 可复用；Memory/Activity须有可恢复的后台暂停，不用 close 后重建冒充保持服务。

排空回执区分“在途已结束”与“持久等待恢复”：当前模型/路由/发送/executor/分析/媒体/维护在途必须归零，费用均有结算或明确未知；已 accepted 的消息、原Task、待人格整理的结果可保留在数据库并绑定恢复水位，不能为等 pending=0 而重跑模型或直接发送报告。新增未知项单列；历史终态unknown不因换代码被删除或自动重派。只有相同 token、相同快照/归属的回执可许可 stop/apply。

夜间窗口仍按原 cycle ID 顺序执行 Memory屏障→归档→冻结计划/私有快照→受限日志Run→Git CAS→history完成。窗口内日志/维护调用照常扣共享预算；预算不足停在真实阶段。更新等待该窗口释放，夜间也不能在更新安装/恢复中开始；并发请求排队或返回明确占用，不互相抢锁。

`submit` 只持久排队并立即返回；不能在调用它的管理员 CLI 内等待自身 executor 空闲。daemon随后申请窗口，待原任务闭合，结果仍走新人格交付链。维护窗口请求、确认和释放均幂等；来源撤销/重启后旧 token 无权重新开放业务。

## 5. 四个更新工具继续进入管理员 CLI

保留名称 `dafeiyu_update_prepare/submit/status/history`。最小选择是在专用 headless 的受信插件中固定注册四个窄 wrapper，复用现有 guard CLI 命令协议；**不加载旧 QQ/Bili bundle、OwnerDmWorker、旧人格或旧全局消费者**。不恢复任意 plugin import 或全局工具继承。

新增 `packages/server-executor/src/headless-update-tools.ts`；扩展 `headless-manifest.ts` 的固定枚举/pins与 `headless-plugin.ts` 的显式装配。wrapper仅启动已 pin 的 Node 和 `程序/update-guard/cli.mjs`，action固定，root来自受信运维绑定，模型只能传受限 reason/id。guard CLI 新增显式受信 root 参数，不依赖 DSH_QQ_BRIDGE_ROOT/default ROOT；普通入口不得调用 initialize 或在缺库时建新账本。

SDK现有 tool guard/IPC准入继续覆盖四个名称，调用前与调用期间校验父Task/操作、pins和live guard；加入允许名单不新增QQ主人或自主权限，仍由当前真实 Core 外部任务授权决定。每次工具只返回结构化 job ID、候选路径、状态和安全错误码，输出长度有界；stderr、凭据和任意异常正文不进入模型。CLI子进程终止不等于数据库未写入：prepare/submit须有程序幂等requestId/receipt，未知先查原请求，不自动重建候选。

原 prepare→候选编辑→submit→daemon验证/备份/排空/切换/健康/回滚流程保留。用户可结束发起任务后再通过 status/history查询；不直接从executor向QQ发状态报告。`tools.mjs`可保留给明确的旧运维入口，但不能以“旧profile里有包”替代新专用CLI的四个工具检查。

## 6. 候选清单、接管与回滚边界

新版 `Files` 使用部署固定的 releaseRoot/文件清单与外部依赖清单：新包源码、编译产物、package/lock、固定launcher/profile与公开配置可被核验；只允许列明的代码叶子变更。官方基础文件、guard/maintenance本体、平台/model凭据、资金授权、standing authority、账户绑定/交接代际不得由普通候选改写。凡引用到受保护依赖，仅校验原字节，不将它变为可替换副本。

新增 Host各SQLite、DSH session/query、persona/关系/偏好、媒体导出、历史库、guard库、运营资金库/receipts、executor jobs、QQ/Bili发送ledger、seen/queue/since/precision、维护与版本计划均排除代码回滚；`.runtime`/node_modules可写缓存也不能因落在程序目录下就被收进release。Git工作树/用户暂存区不由guard重置。

**首次接管不能直接把旧stableId用于新capture规则。** 独立维护步骤先验证无active update、备份现有guard数据库/快照、冻结旧消费者并完成新Host交接；保留旧schema1快照和全部事件，再追加 `handover-to-managed-host` 记录及新清单schema/稳定快照，关联 priorStableId、inventory、generation和真实验收证据。不得重跑旧 initialize 清历史；自动回滚的下界是本次新消费归属的边界，不能穿回旧profile重新启用旧QQ/Bili。

候选声明前后可读schema及运行数据兼容范围。默认启动不做正式库迁移；需迁移时走显式备份/校验步骤。回滚前验证旧代码能读取**当前**数据与最新发送／费用事实；不兼容时保留停止、标记 rollback-blocked，不以旧数据库备份覆盖新增数据来“恢复健康”。本地备份用于恢复损坏，不是常规撤销现实行为。已发送与unknown永久保留其原回执。

`Validator` 新增固定受管 TypeScript构建/相关测试入口及固定Host/CLI离线装配检查；候选源码与lib、依赖解析和launch pins相互对应。diff须包括删除项，缺入口/required feature、假factory、任意modulePath、官方基础hash改变均拒绝。测试使用虚构资料与无网络端口，不能拿真实凭据/账户作自检；管理员执行环境不是OS沙箱，清空env不能保证任意恶意代码隔离。

guard事件归档继续保留原outbox顺序和原key。`Store.mirror`改用existing-only、schema/文件身份验证与幂等冲突检查，不因历史库缺失创建替代库；必要时为 `ExistingArchive` 增加窄 `appendGuardEvent`，不改既有records或用新版前缀重放旧事件。归档失败保留积压，不伪造mirrored成功。

## 7. 精确实施文件清单

| 文件 | 最小修改 |
|---|---|
| guard `platform.mjs`、`control.ps1` | 按固定target分离Host/Desktop；新身份/健康/窗口/排空回执与精准启停。可将新实现拆到 `managed-host-platform.mjs`。 |
| guard `engine.mjs`、`store.mjs` | job target/代际、窗口token、verification_suspended/rollback-blocked及恢复；显式接管迁移；existing-only正常入口和原outbox安全归档。 |
| guard `files.mjs`、`validate.mjs` | 新release白名单、基础/数据/授权保护、兼容schema、删除项、TS受管检查和固定依赖pins；保留旧manifest只读兼容。 |
| guard `client.mjs`、`cli.mjs`、`daemon.mjs` | 显式根/模式、严格命令与幂等receipt、机器级运维协调和恢复；原4工具名与SYSTEM进程保留。 |
| guard `guard.test.mjs`及新增managed-host测试 | 下述恢复/并发/预算/数据保护矩阵；不直接替换线上代码执行自测。 |
| `packages/host/src/runtime.ts`、`status.ts` | 可恢复maintenance接口/投影；排空回执和业务hold；显式coordination连接。 |
| `packages/core/src/index.ts`、Memory/Activity相关生命周期端口 | 区分可恢复准入hold与终止quiesce；本窗口维护资格，禁止凭模型字段发token。 |
| `packages/server-runtime/src/{cli,launch-config,lifecycle,production}.ts`，新增 `operations-control.ts` | 固定control/coordination绑定、boot/stop receipt、资金稳定停止分类、guard控制端口；不改变资金授权额度。 |
| `packages/server-executor/src/{headless-manifest,headless-plugin}.ts`，新增 `headless-update-tools.ts` | 固定四个工具、Node/guard CLI闭包pins、结构化输入输出及现有IPC工具准入。 |
| 新夜间服务与 `packages/server-compat/src/archive.ts` | 共用维护窗口、原cycle/Git阶段CAS、窄guard归档；不另建人格或聊天系统。 |

共享接口应先冻结，再分配源码ownership；本表列的是待实施文件，不代表目前已有这些端口。guard自身升级始终走独立维护步骤，普通候选仍禁止改其本体。

## 8. 本地与上线门槛

先做受管无网络检查：坏launch/pins/必需插件拒绝；假/旧boot与SYSTEM路径错位拒绝；新Host启动故障仅回滚其代码；基础Desktop hash及运行保持；停止回执缺失不apply；预算到限/过期/unknown不重启风暴、不增额；update与23点cycle互斥及崩溃恢复；四工具通过真实CLI/IPC调用且无旧消费者；prepared/commit_prepared原样恢复；新增记忆/回执/资金记录及用户index在回滚后保持；schema不兼容阻断回滚；旧stable不能越过交接边界。

服务器正式动作前仍须只读核实：当前activeId/job/stable manifest版本与digest、daemon计划任务/SID/进程身份、13文件及vendor闭包、实际Desktop与新Host进程、双方共用coordination路径、旧全部消费者/版本写者状态、当前schema与未决版本阶段、资金有效性与未确认子进程。仅取必要公开元数据／统计，真实数据库与记忆在服务器原位备份，不拉私密正文。只有冻结候选后的真实检查完成才能切换，不能复用旧桌面12项或本次静态审阅作为新守护验收。
