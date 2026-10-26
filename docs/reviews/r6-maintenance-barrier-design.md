# R6f-4 可恢复维护窗口与唯一记忆屏障

2026-10-27。实现前接口方案；仅静态读取源码，未改源码、运行测试、连接服务器或调用模型。本步供根代理审核、冻结接口后实施。沿用 [R6f 细案](../server-runtime-r6f-plan.md) 和 [守护接管设计](r6-update-guard-handover-design.md)，不开始修改 guard。

## 1. 现有接缝与必须修正的含义

| 位置 | 已有能力／具体缺口 |
|---|---|
| Host `runtime.ts:206`、`ServiceGate` | close/quiesce不可恢复，不能用作维护pause；refresh还会把Core不accepting当故障关闭。 |
| Core `index.ts:237/652`、`execution-coordinator.ts:400/448`、`native-task-delivery.ts:48` | accepting同时控制新请求、已accepted消息/Run派发和目标人格交付，直接置false会把应先排空的工作搁置。 |
| Activity `scheduler.ts:25/92/166` | 已有唯一WakeAuthority、唯一Memory connect与串行tick；维护和探索共享调度器，可增加模式过滤，无需第二timer/调度者。 |
| Memory `experience-store.ts:197` | pendingScheduling只枚举waiting/ready，不能证明failed/stale/cancelled/completed已覆盖。 |
| Memory `experience-store.ts:200` | coalesce可能指向较新terminal请求，当前未限定cutoff；冻结后不能偷偷扩大覆盖范围。 |
| Memory `experience-store.ts:188` | settleMetadata把无内容事件写为completed；它不证明发生过内容整理或人格改变。 |
| Memory `experience-store.ts:102/118`、Activity `store.ts:143` | running恢复为failed，begin不接failed；once计划派发后已exhausted。单靠重启和现有tick不能恢复这类失败。 |
| Memory `analysis.ts:35/182` | 原独立分析队列有activate/quiesce；whenIdle只等当前worker，暂停后的queued不能被误算完成。 |

屏障的语义严格限定为：**冻结范围内已有、合法保留的维护请求及其真实处理结果得到完整核验。** 它不是重新扫描全部私聊／原始会话，也不把未选中的观察或旧人格加入模型。当前维护请求是Task范围；普通对话分析队列另按已有授权排空并记录状态，不伪造成跨scene的统一维护Task。

## 2. Host公开程序接口

新增独立模块 `packages/host/src/maintenance-window.ts` 与 `maintenance-store.ts`，由ManagedHost持有，模型工具和普通插件不获得控制handle。

```ts
type MaintenancePurpose = 'nightly' | 'update';
interface MaintenanceWindowHandle { readonly id: string } // 实例身份在Host WeakMap内核验
beginMaintenance(input: { requestId: string; purpose: MaintenancePurpose }): Promise<MaintenanceWindowHandle>;
maintenanceStatus(id?: string): MaintenanceWindowStatus | null;
advanceMaintenance(handle: MaintenanceWindowHandle, options: { signal: AbortSignal }): Promise<MaintenanceWindowStatus>;
endMaintenance(handle: MaintenanceWindowHandle, input: { outcome: 'completed' | 'deferred' }): Promise<MaintenanceWindowStatus>;
```

`begin`同requestId/同purpose幂等；不同请求占用同一窗口资源时返回 `MAINTENANCE_BUSY`。status仅给真实持久状态/水位/计数/安全错误码，不返回记忆或对话正文。handle不能序列化为授权；复制 `{id}`、来自别的Host/旧boot的handle、任意guard函数均不能推进或释放。恢复由Host启动时重新核验持久窗口后铸造新handle，不由调用者JSON声明恢复资格。

`advance`一次推进到当前可达的稳定点，允许返回waiting/blocked；等待使用原Activity调度器的到期时间，不创建独立轮询模型的scheduler。`update`窗口先完成排空并保留冻结检查点，可停在held供guard切换，不要求为每次更新额外触发整理模型。`nightly`必须取得下述屏障回执后才可进入归档/日志；日志Run属于后续独立授权阶段，不能借本步Memory permit运行任意日志/平台动作。

`end(completed)`要求用途对应的真实回执，不能由调用者填一个布尔值越过；`end(deferred)`记录未完成原因，已提交结果保持，释放业务hold但不产生屏障成功。重启后同requestId继续原cutoff和成员。close仍是永久关闭，关闭时保留窗口阶段，不隐式end或写completed。

## 3. 分阶段准入与先排空

状态：`holding → draining → frozen → maintaining → complete → released`；等待资金/时间/来源处理停在 `blocked` 并记原phase，进程重启保留 `interrupted` 证据后恢复原phase；不回退已完成成员。update可从frozen进入held并以停止回执结束。窗口phase与Host生命周期分开，Host维护期间保持服务active、业务accepting=false。

1. 获取唯一窗口，先持久request与当前开关，再同步关闭QQ/Bili新入站、Host.run、外部新Task与Activity新探索派发。QQ现有buffer保留；Bili停止新poll。渠道尚未交给Core的pending/held另记deferred，不称已处理。Core已accepted的消息、Run、原交付构成工作cohort，冻结其ID/输入hash/版本。
2. **保持这些已有工作的继续执行和发送。** 不在此时quiesce Core/Memory/渠道/executor；否则已有任务内部的合法步骤和目标人格交付会失败。已有conversation在实际live context内产生的显式MessageTask可作为因果后代加入cohort；Core必须验证parentRun/原inbound/真实binding并持久关联，不能通过模型传parentId。新self-exploration、任意producer提交、Host.run及新计划触发仍拒绝。已有Task内原授权动作可以闭合；不扩大其原权限。
3. 原Activity暂停新issue/dispatch，但保留既有occurrence的控制、终态对账；不新建探索Task、不为旧waiting探索自动创建resume。Core既有cohort、其因果交付与普通Memory分析队列先按真实结果闭合；waiting、失败、unknown保留其原事实。预算耗尽或无法确认退出则窗口blocked，不靠强制改状态获得drained。
4. 排空后回放/flush Core lifecycle→Memory、Memory outbox→journal、Activity receipt；核对无遗漏ack，再冻结Memory请求范围。不能先取cutoff再忽略最后一个完成事件。排空回执列明已结束、仍等待/未知、渠道deferred及原分析队列状态；“in-flight为0”仅证明此项，不证明业务成功或记忆整理完成。
5. frozen以后只允许本窗口精确维护成员进入Core；QQ/Bili网络会话和租约保持，来源复验仍可用。屏障结束恢复进入前的开关，不把原来disabled/offline的组件擅自打开，不取消或重建已存在活动计划。

## 4. Core最小可信接口（由根代理实现）

建议新增 `createManagedCoreMount()`，返回现有Core插件装配对象及一个闭包绑定该Core的 `CoreMaintenanceController`；Host保存controller，不挂到 `ctx.dafeiyu`，旧普通Core插件入口保留。这样无需用可复制JSON字段证明“我是Host”。其他插件即使自行创建另一个mount也不能控制本Host已装配的Core。

```ts
interface CoreMaintenanceController {
  holdBusiness(input: { windowId: string; requestId: string }): CoreMaintenanceHold;
  drainStatus(hold: CoreMaintenanceHold): CoreDrainReceipt;
  flushLifecycle(hold: CoreMaintenanceHold): CoreLifecycleCutoff;
  bindMaintenanceLane(hold: CoreMaintenanceHold, bridge: MaintenanceProofBridge): MaintenanceExecutionLane;
  releaseBusiness(hold: CoreMaintenanceHold): void;
}
```

hold/lane由Core私有WeakMap绑定真实实例、窗口及有效期；不是只信对象自带guard。Core拆出 `canAdmitBusiness`、`canContinueMessage/Run`、`canContinueAnalysis(grantId)`、`canDeliverResult`，原通用accepting不再承担这些角色。新业务入口继续拒绝；调度、原分析队列与NativeTaskDelivery只放行冻结cohort及已核验因果后代。来源、Task epoch、policy、预算、unknown与objection屏障保持。

现BiliOwnerTasks的admitting回调只看active/!held/verified，会提前拒绝上述旧conversation的显式Task；需最小改为接收真实ExecutionContext，由Core判定该次是否属于drain cohort。它仍不能凭model字段或单一来源有效就绕过新任务禁入。QQ/Bili使用holdIngress，不调用quiesce；原构造失败/排空禁止新任务的断言保留。此窄接缝由根协调渠道文件ownership。

`MaintenanceExecutionLane`只交给**现有ActivityScheduler实例**，允许打开指定已有Task、接受其精确maintenance wake、查询/暂停/安全续接该occurrence；没有createTask、任意submit、改目标、平台/external-write等方法。每次准入Core共同验证：window phase/lease、冻结member、Memory真实bodyHash/watermark/epoch、Activity持久plan版本/occurrence、原Run anchor、维护policy与live来源；由Core绑定新的Run ID。普通 `executionProducer('activity', {motivation:'maintenance'})`、伪maintenance origin、复制occurrence或JSON permit都不能获得例外。

bridge仅是程序查询接缝，注册由controller持有者在Host装配时完成且只能一次；不能把任意插件提供的 `valid:true` 当证据。Memory/Activity桥返回精确只读记录，Core仍核对自己保存的Run/来源/政策；供模型的context继续标instructionAuthority:false。

维护policy首版只允许已有 maintenance_status/consolidate/result、必要的当前Task source_open/source_state及体验只读核对；是否需要execution_select由原来源曝光合同确定，不开放任意新资源。不能添加外部执行、频道发送、Activity计划、人格trial/adoption/publish或经验accepted写动作。保留MaintenanceSnapshot的原motivation/goal与scope，维护动机不改写原经历动机。

## 5. Memory冻结清单与逐项真实证明

由 `MaintenanceService` 暴露只供Host/原scheduler连接的 `barrierPort()`；仍调用原 `schedulingPort.connect()` 一次，不另连第二scheduler。ExperienceStore增加窄元数据读取，Host不直接遍历memory私有SQL。

```ts
freeze(input: { windowId: string; lifecycleCutoff: CoreLifecycleCutoff }): MaintenanceFrozenSet;
inspectMember(ref: FrozenMaintenanceMember): MaintenanceMemberProof;
coalesceWithin(ref: FrozenMaintenanceMember, cutoff: MaintenanceFrozenSet): CoalesceProof | null;
retryKnownUncommitted(ref: FrozenMaintenanceMember, expectedVersion: number,
  authority: MaintenanceRetryAuthority): RetryReceipt;
```

freeze用同一只读事务枚举截止max(rowid)的**所有状态**；序号采用十进制整数串，不先Number丢精度。保存请求id、原body hash、watermark、scope/task/epoch、原Run、来源/历史/targets摘要hash、初始状态/version、是否有内容/omitted。完成行也纳入核验；后续新请求不进入本轮。清单hash绑定Core lifecycle已闭合水位与Memory最后序号。

coalesce只能在冻结成员闭包内进行，并比较相同scope/epoch/Run/goal与精确源引用覆盖；持久保存from→to证据，不以“cancelled”直接成功。若唯一可覆盖target在cutoff之后，本轮from保持待处理/blocked，不偷偷增加分母或丢弃它；下一窗口可处理新证据。

每个成员只允许以下真实分类：

| 分类 | 必须核验的证据 |
|---|---|
| `consolidated` | 原请求completed且未变body；maintenance_watermark精确匹配；result可解析且hash稳定、其依赖仍有效；实际memory.maintenance.completed审计与原consolidate操作/执行Run对应；Core Run已闭合，操作效果／未知项如实保留。模型最终说“整理完成”不计。 |
| `coalesced` | 精确from→to证明，to同属cutoff且最终得到可接受证明；环/跨scope/越界均拒。 |
| `no-content` | 程序重查原sources/history/targets、omittedSources与实际event；确实没有允许做内容分析的材料。单独列数量和来源，不称语义整理、采用或模型处理。不得只看metadataOnly/result或调用settleMetadata就通过。 |
| `pending/running` | 保留计划/occurrence/Run和当前版本，仍未完成。 |
| `failed/stale/cancelled/uncertain` | 保留原因与原请求；不可从全集消失、自动计为成功或改用新目标。无有效coalesce/安全恢复证据时阻止屏障成功。 |

barrier模式禁止scheduler的settleMetadata捷径；旧metadataOnly completed只能经no-content独立核验归类。`no-content`清单可以证明本cutoff无可分析内容，不能宣称进行过整理。屏障回执给出 `contentConsolidated/coalesced/noContent/blocked` 明细与范围；夜间消费者不能只取“pending为空”或单一completed总数。

内容请求即使分析结论为空数组也可以consolidated，前提是确实走过原MaintenanceService、引用/来源/事务校验及实际Run回执；不机械要求产出新偏好。正常结果仍是proposed经历和held关系/人格建议，本步不自动采用人格。

## 6. 原ActivityScheduler的过滤模式与失败恢复

新增 `ActivityService.enterMaintenanceMode(handle, frozen, lane)` / `leaveMaintenanceMode(handle)`，内部只改变同一个scheduler的模式：`normal / drain / barrier`。原timer、pending Promise、WakeAuthority、事件订阅和Memory连接全复用。

- drain：不导入新maintenance、不issue新探索；只对已接受occurrence执行收尾/回执对账。冻结后barrier只import清单内成员、dispatch其持久maintenance plan，不触发清单外计划；原探索schedule不改版本/nextDue来假装未发生。
- 保留真实quiet/minInterval/backoff/单任务与日时长限制；尚未到期返回nextEligibleAt，不改时钟或绕过预算来强行完成23点整理。维护期间不让新探索抢占，已有预算不足则blocked。
- Activity的maintenancePlan、occurrence、ack、Run事件是执行证据；屏障进度从Memory proof重算。Run completed而请求未completed继续blocked；请求已completed但生命周期ack丢失，按既有reconcile从Core权威事件补投影，**不再次调用模型**。
- failed/interrupted不能盲重试。首先查同请求的真实commit/watermark：若已原子提交，仅修复缺失receipt/对账；若没有commit且有程序证明本次未提交、原来源仍有效、资金/未知操作门槛允许，才用expectedVersion CAS记录retry receipt并恢复同请求资格。保留原body/hash/失效时间/动机，追加attempt，不覆盖旧失败审计。
- 若结果是否提交或费用仍未知，留uncertain；不以“表里暂时没有结果”证明没有副作用。first版只自动恢复可证明的本地原子consolidate失败，不扩展到任意旧操作重放。原一次性plan已exhausted时，原scheduler创建与retry receipt绑定的明确新attempt occurrence，保留旧occurrence；不能用新的普通探索目标凑成功。

需为MaintenanceService补窄 `MaintenanceAttemptReceipt`：request/bodyHash/watermark、实际Core runId/operationId、attempt、commit resultHash或known-uncommitted分类、完成/失败事件引用。成功receipt与Memory commit在同一事务；失败receipt只有在已确认未commit时产生。Core原unknown记录不得被静默改写；有缺口时追加受信reconciliation证据，仍保留原未知历史。

## 7. 持久化、互斥与重启

新增 `<config.paths.core>/maintenance.sqlite`，独立application ID/schema v1，显式Host init/migrate建库，普通启动existing-only。这与后续guard夜间共用同一固定profile运维资源；系统级绑定由受信launcher选择，模型不得提供路径。

建议表：`maintenance_windows`（requestId唯一、phase/version/ownerBoot/lease代际）；`maintenance_window_revisions`（追加状态）；`maintenance_members`（windowId/requestId唯一、冻结元数据/hash）；`maintenance_attempts`（member/attempt、occurrence/Run/receipt关联，禁止两次活动attempt）；`maintenance_window_events`（append-only）。数据库不复制正文、凭据或旧人格。窗口租约CAS与请求指纹防止nightly/update并发；按真实进程/Host owner恢复，不能只靠timeout偷锁。

Memory12原请求正文/hash不改；ExperienceStore新增窄读取/retry/receipt接口可复用既有不可变maintenance_receipts与outbox，不把这些写端口开放给模型。若最终需要新增Memory表，必须单独迁移并同步所有版本guard/备份清单，不能偷偷startup CREATE。Host侧新增库亦须进入manifest requiredStores、init/migration备份/验证与诊断；关闭功能后仍保留既有窗口。

Host启动先检查未释放窗口，Memory/Core恢复后仍hold新业务，重建live handle/lane并校验同一cutoff、policy/source/DB身份；不能先releaseIngress再补窗口。已completed成员只读取证明，不重做。新来源/epoch改变导致blocked；冻结后新事件留给下一轮。end恢复进入前的timer/分析/渠道开关，并只释放本窗口持有的gate；自动恢复不能解除其它故障/资金停止。

## 8. 最小实施分工与验证

主代理 2026-10-27 接口审核：采用上述“先保留在途工作继续权，再冻结真实维护集合”的方案。按子步实施：① Core 私有控制器、已有 cohort/因果后代及交付继续权；② Memory 全状态冻结、结果证明和窄安全恢复接口；③ 原 Activity scheduler 的模式过滤与精确维护 lane；④ Host 可恢复窗口、显式存储迁移/启动恢复与渠道控制；⑤ 夜间消费者消费真实屏障。每子步单独相关检查、记录和 Git，不把控制器雏形标为完整夜间接管。

本次分工：语义审阅代理先做①（含 Core 与必要 Bili Task admission 窄接缝），证据代理在读取服务子步结束后做②；执行设计代理先完成启动状态收据再做③。主代理继续生产薄 CLI/legacy 装配和④/⑤，统一构建。共享 contracts 的新维护类型先由②提出精确接口清单，再交主代理合并；各代理不得争写 Host/runtime.ts、Memory/source-policy.ts 或他人负责的文件。上述私有程序接口不供模型获取，不恢复任何旧调用次数上限。

本代理可实施：Host runtime/status与新增window/store；Activity service/scheduler模式及必要attempt接缝；Memory maintenance-service/屏障proof新文件；`tests/server-maintenance*.ts`。需根先对齐并负责或明确追加ownership：Core私有mount/controller、分离准入和continuation/delivery谓词；ExperienceStore窄读取/原子receipt/retry；MemoryAnalysis受信cohort准入及Bili任务准入窄接缝；contracts与Host显式存储注册。现阶段不改guard、资金账本、persona采用门槛或夜间Git实现。

接口冻结后分批受管验证：

1. Host不close即可hold→恢复；新QQ/Bili/Host.run/探索拒绝，已经accepted的Run/因果Task/人格整理/发送先闭合；没有重跑原任务。
2. 一个scheduler/connect/timer；复制handle、伪maintenance motivation/origin、其它plugin/Task/越界member不能进入例外lane。
3. 全状态cutoff覆盖，后到请求不混入；跨cutoff coalesce拒绝；metadataOnly、pending空、模型说完成均不能替代proof。
4. 真实DSH脚本模型触发consolidate，独立分析和Memory原子结果/水位/Run对应；空候选合法，反证/原动机/任务范围保留，不adopt。
5. commit前后、ack前后、窗口freeze/release前后故障恢复；completed零新模型，known-uncommitted按同请求CAS恢复；未知/来源撤销/Task改代/费用停止保留blocked。
6. quiet/backoff/预算用真实状态等待；nightly/update同库互斥；重启保持hold且旧token失效；恢复只还原原开关；新增真实数据及原hash保持。

本方案可完成可核验的维护请求屏障，不声称程序能证明归纳内容的语义真理。后续夜间服务须消费这个有范围的真实回执，才能把原cycle推进到archiving；不能提前声明23点版本已经发生。
