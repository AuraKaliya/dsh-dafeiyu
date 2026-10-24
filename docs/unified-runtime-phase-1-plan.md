# 第一阶段：大肥鱼核心与统一运行入口开发方案

日期：2026-10-24（北京时间）。方案版本：1.1（人格成长与连续性修订）。

实施状态：**1A、1B、1C已完成，1D—1G尚未完成**，结果见[1A验收](phase1a-adaptation.md)、[1B验收](phase1b-lifecycle.md)、[1C验收](phase1c-storage.md)。本方案编写时仅交付文档，原核验过程保留在第16节；当前实施进度以各子步骤验收为准。尚未创建正式Host运行入口、迁移真实数据库或切换QQ／服务器。

1D中途实现和接续事项见[开发检查点](phase1d-checkpoint.md)。本轮按用户认可的边界新增[大肥鱼人格成长与连续性方案](persona-growth-continuity-plan.md)，同步修订本方案；只改文档，不继续功能开发。正式底色将按新方案后续新建，不采用管理中心现有人格文件；正式人格与成长验收仍未完成。

上位方案：[大肥鱼统一运行、唤醒与插件协作接口方案](unified-runtime-wakeup-plugin-plan.md)。本文将其中阶段1细化为可实施的契约、装配顺序、状态机、数据变更和验收标准；没有把后续QQ增强、记忆E、自主活动或B站开发提前算作本阶段完成。

初版核对基线：Git `a1d5844`／功能代码`1046653`。本次修订核对`685221c`：项目仍为`0.19.0`，contracts/core/memory仍为`0.15.0`，v2常量保留并已有独立v3注册；DSH `0.2.1-rc.2`、Cordis `4.0.5`、Node开发基线`24.13.0`。1C已实现journal v2、memory v7、runtime v1；本修订设计的memory v8、runtime v2及人格服务尚未实现。

阅读顺序：第1—3节确定范围、代码依据和交付结构；第4—7节定义Host、配置、兼容与执行接口；第8—10节定义人格、任务运行和持久化；第11—13节规定迁移、故障与验收；第14—16节安排实施、Git及本轮文档核验。

## 1. 阶段目标、范围与完成定义

### 1.1 本阶段必须形成的结果

1. 一个明确的Host入口可以检查配置、装配DSH与插件、恢复状态、开放工作，并按顺序关闭；保留原验收脚本的兼容性。
2. 插件完成注册、数据检查和依赖恢复之前，不处理旧消息、不接收新任务、不启动分析工作者。
3. v2插件保持原会话范围与行为；v3能力可以在没有聊天消息的任务中执行，采用独立的任务会话及真实程序来源。
4. 身份与爱世界的底色按Run固定；阶段人格及成长资料由记忆按来源、用途与范围提供，选择、试行、采用、撤下及重启保持均可核验。
5. 核心具有Task与Run的明确关系、持久受理、取消／恢复和操作记账；Run完成不会自动向QQ发送。
6. 新内部任务能保存文字观察及选中贡献，能按既有授权使用选中记忆；不以虚构Conversation换取权限。
7. 迁移可预检、备份、实施、验证与中断恢复；原消息、来源、记忆版本、删除状态、回执和DSH会话不被重置。
8. 有确定性测试、真实DSH集成、新底色与阶段人格的真实模型评估、压缩接续对照和必要模态探针，分别报告证据与限制。
9. 兴趣／偏好／看法保持独立；明确任务认真执行并允许提出异议；任务动机、任务立场与人格更新分别记录，不以迎合为成长依据。

### 1.2 范围界线

| 内容 | 本阶段处理 |
|---|---|
| QQ现有文字链路 | 只增加受控启动／排空的生命周期适配，保持现有收发、触发和账号规则；验证兼容 |
| QQ浏览、自然称呼、群同步、分段、真实任务交付 | 阶段2；本阶段不改变D3模拟交付限制 |
| 成长状态 | 实现有来源的显式候选、阶段版本、选择／撤下、场景投影与Run清单；不自动归纳全局兴趣或关系 |
| 记忆E算法 | 整体阶段3；本阶段提供状态基础和显式更新路径，自动经历关联、候选归纳与整理算法仍后续实施 |
| 任务与独立判断 | 核验任务身份、业务动机、异议及解决；任务目标变更仍走原Task epoch；真实QQ任务入口整合在阶段2 |
| 连续性 | 底色／阶段状态独立于聊天摘要；检查点保留任务、反证、约定与缺口；无思考文本归档或主观体验证明 |
| 自主活动 | 本阶段提供持久唤醒接收端口及测试生产者；真实Schedule、定时／条件调度在阶段4 |
| 媒体 | 做DSH来源／图像、真实音轨识别及声音事件服务的可行性探针，记录结果；完整媒体管线在阶段5 |
| B站 | 阶段6；首版真实画面和音频理解要求不变，本阶段不抓取B站或新增平台能力 |
| 主动消息和跨场景对外交付 | 本阶段内部Run不具备真实发送入口；保留旧D2/D3数据与模拟回归 |
| 运行控制界面／网络管理接口 | 本阶段提供本地入口和受信原生API；不新增公开HTTP控制面 |
| 服务器 | 后续独立部署阶段；本阶段不连接或改动 |

本阶段的无聊天任务至少完成“本地受信请求→Task／Run→DSH人格运行→调用无渠道v3能力→记录观察→按选择贡献记忆→持久结果→重启核验”。未加载QQ插件也应通过。只有类型声明或模拟业务函数、没有真实DSH运行，不满足此项。

## 2. 现有实现核对与改动依据

下表保留初版设计时的代码边界，不能将其“当前”列作为`685221c`的完整状态。该基线现已具备受控生命周期和存储迁移，1D新增原生执行协调器、共享ExecutionFrame／DSH回合辅助、可见流过滤和聊天结果投影；这些仍是中途实现。具体人格缺口及新增数据责任见[人格方案第10节](persona-growth-continuity-plan.md#data-evolution)。

| 当前代码／符号 | 观察到的行为 | 第一阶段具体处理 |
|---|---|---|
| [scripts/local-host.mjs](../scripts/local-host.mjs)，`localHost` | 固定测试人格及模型路由；只装配核心、可选时间线和模拟渠道 | 新Host按配置装配；旧脚本继续作为兼容验收驱动 |
| [core/index.ts](../packages/core/src/index.ts)，构造器 | 打开Journal、DeliveryStore并执行部分恢复 | managed模式先验证数据，后显式恢复；不得把构造器当只读预检 |
| 同文件，`registerExtension` | 注册后立即调度accepted／reply-ready消息 | 增加准入屏障；managed模式登记待恢复工作，统一开放后调度 |
| 同文件，`process` | 从入站记录驱动模型，再自动走原渠道发送 | 拆出通用Run执行；保留聊天完成到原交付状态机的适配 |
| 同文件，`scopeFor`／`observationAuthority` | 用WeakMap确认ActionContext；无上下文观察要求拥有渠道 | 保留句柄身份校验；v3通过执行授权确认内部任务，不要求渠道 |
| [core/runtime.ts](../packages/core/src/runtime.ts)，`DshRuntime.run` | 参数为PendingMessage；输入source.kind=user；结果要求最终文字 | 改为内部ExecutionFrame；聊天适配保持旧来源，自主输入使用新程序来源 |
| [context.ts](../packages/core/src/context.ts)、[context-runtime.ts](../packages/core/src/context-runtime.ts) | ContextRequest、审计、装配均依赖入站／route | 增加ExecutionScope与v3贡献入口，旧贡献只在真实聊天运行调用 |
| [feedback-runtime.ts](../packages/core/src/feedback-runtime.ts)、[compaction-runtime.ts](../packages/core/src/compaction-runtime.ts) | 历史退出与摘要证明绑定既有来源结构 | 增加Run输入、内部观察、成长引用的来源适配，不能仅换入口后绕开校验 |
| [journal/index.ts](../packages/journal/src/index.ts) | schema v1，事件可见范围固定conversation；构造器建表并占用 | schema v2增加task范围事件读取与严格身份预检；旧事件保持 |
| [task-coordinator.ts](../packages/core/src/task-coordinator.ts) | 任务控制器、工作引用由核心签发 | 增加TaskRepositoryPort适配及执行端口，继续使用原任务ID |
| [memory/index.ts](../packages/memory/src/index.ts) | 构造中注册提供者、recover任务／表达并启动analysis | 分成open／bind／recover／activate；保留legacy启动方式 |
| [memory/task-workspace.ts](../packages/memory/src/task-workspace.ts) | Task与版本已持久化；工作票据及成员需要Conversation；内部审计使用旧agent-task route | 复用Task仓储；v3运行与结果使用独立绑定，不伪造旧工作票据；旧route不改写 |
| [memory/boundary.ts](../packages/memory/src/boundary.ts)、[source-policy.ts](../packages/memory/src/source-policy.ts) | 默认边界为原会话，来源读取使用Journal消息 | 为新内部记录增加明确task范围与来源提供者；旧记录不自动扩大 |
| [channel-qq/index.ts](../packages/channel-qq/src/index.ts)，`apply` | 构造后立即start并建立连接 | 只增加managed生命周期开关，Host决定何时start；默认legacy语义不变 |
| [tests/harness.ts](../tests/harness.ts)、[recovery.test.ts](../tests/recovery.test.ts) | 当前脚本模型＋真实DSH及恢复测试 | 作为兼容基线，新增managedHost和无消息任务夹具，不改旧断言掩盖回归 |

本地DSH的 `dsh-llm/lib/types/message.d.ts` 定义了可扩展 `MessageSourceMap`，user-role消息允许携带生产者来源；`form='notice'`要求summary。AgentRegistry已有create／resume／dispose，AgentLoop已有followup／cancel／whenIdle。静态接口支持拟方案，但自定义来源跨JSONL保存、恢复、查询和压缩的行为仍须实测。

初版核对发现DshRuntime仅D3分支过滤reasoning／replay；1D检查点已扩展managed聊天与任务过滤。后续仍须用新底色、成长／压缩材料验证完整持久链，不能仅因业务日志未记录就声称DSH持久文件也不记录，也不能把1A探针等同新组合的真实验收。

## 3. 交付结构与依赖关系

### 3.1 包与实现归属

| 位置 | 本阶段新增／调整 |
|---|---|
| `packages/host/`（新增） | 配置、清单目录、依赖检查、生命周期、CLI、预检和健康快照 |
| `packages/contracts/src/execution.ts`等（拟） | v3执行／生命周期／TaskRepository／成长／内部观察接口及Schema |
| `packages/core/src/` | 统一注册表、准入、ExecutionFrame、Run协调／存储、授权、恢复适配 |
| `packages/journal/src/` | schema v2及task事件范围，旧conversation查询保持原过滤 |
| `packages/memory/src/` | managed生命周期、v7基础与v8人格增量、Task仓储适配、GrowthProvider／PersonaGrowthPort／ContinuityPort、文字ExecutionMemoryPort |
| `packages/timeline/src/` | task来源的受控访问适配；普通聊天检索不会获得任务范围 |
| `packages/channel-qq/`、`channel-simulator/` | 最小生命周期适配及兼容验证；不增加QQ业务能力 |
| `scripts/`、`tests/`、`profiles/` | 新Host驱动、迁移／探针／验收脚本、虚构人格与配置模板；本次仅计划 |

Host依赖具体插件；核心依赖contracts、journal及DSH，通过端口取得记忆／任务服务。记忆依赖核心公共端口和时间线证据服务，不导入Host。contracts不导入核心／数据库／平台实现。现有core类型扩展逐步移至contracts，保留旧导出兼容；不为了消除类型依赖而重写所有包。

### 3.2 本阶段的服务特性

冻结首批特性标识：`execution.task.v1`、`execution.wake-ingress.v1`、`context.execution.v1`、`source.execution-text.v1`、`observation.execution-text.v1`、`task.repository.v1`、`persona.growth-selection.v1`。提供者必须实际实现对应端口才可声明；名称注册成功不等于健康。

本修订拟增加`persona.stage-state.v1`、`persona.continuity.v1`、`task.intent.v1`，分别表示显式阶段状态、检查点与任务动机／异议服务。它们不是已经注册的功能，也不表示自动兴趣归纳或真实活动调度已具备；旧v2／v3清单不因此自动获得新权限。

本阶段不声明 `activity.scheduler.v1`、真实主动交付、B站读取、完整媒体音画等未来特性。旧v2能力以兼容特性标识挂载，不因被Host加载而自动获得v3范围。

TaskRepositoryPort由memory兼容适配器提供，但任务目标／生命周期语义属于核心。新的runtime.sqlite记录Run，不再维护另一份可独立编辑的Task目标和状态。

## 4. Host状态机、插件装配与关闭

### 4.1 Host状态

`created → inspected → opening → binding → recovering → ready → draining → stopped`；任一阶段失败进入failed并清理本次取得的资源。可选能力故障记为degraded；必需能力故障禁止进入ready。

```mermaid
flowchart LR
    I[只读预检] --> O[取得占用并打开存储]
    O --> B[绑定DSH与插件端口]
    B --> R[恢复状态与补录]
    R --> G[开放准入]
    G --> W[聊天或无消息任务运行]
    W --> Q[停收与排空]
    Q --> S[逆序关闭]
```

managed模式将“对象存在”“服务绑定”“已恢复”“允许工作”明确区分。使用以下生命周期端口：

```typescript
interface ManagedLifecycle {
  inspect(): Promise<InspectionReport>;       // 只读，不构造业务Service
  open(): Promise<void>;                     // 验证已迁移身份并取得资源
  bind(registry: ServiceRegistry): void;      // 注册端口，不处理工作
  recover(): Promise<RecoveryReport>;         // 修正状态／补录，不调用模型或平台
  activate(): Promise<void>;                 // 就绪后启动被允许的工作
  quiesce(reason: string): Promise<void>;     // 停收与停止新工作，不关闭提供者
  drain(signal: AbortSignal): Promise<void>;  // 等待／合作式取消正在执行工作
  dispose(): Promise<void>;                  // 逆序释放，幂等
}
```

接口名称和顺序在本方案中冻结；DTO由严格Schema定义。生命周期回调是受信程序接口，不作为模型工具。

### 4.2 实际装配步骤

1. 解析Host配置和本地已允许插件清单；解析路径真实身份，检查数据目录／账号占用、schema兼容性、必需模型与人格文件。
2. 取得Host占用；失败即退出。`inspect`阶段不调用Journal／MemoryService等有写入副作用的构造器。
3. 加载DSH基础服务：LLM、会话、投影、提示词、工具、AgentRegistry、JSONL持久化、AgentLoop和SessionQuery；按需加载TokenMeter。AgentLoop保持由核心创建会话的模式。
4. 打开核心与数据存储，准入保持关闭；绑定timeline、memory及TaskRepository、GrowthProvider、ExecutionMemoryPort。
5. 绑定渠道／操作插件；QQ仅构造并注册，暂不开网络连接。注册完成后校验服务图、特性及唯一压缩写者。
6. 执行明确恢复：先确定Task和旧工作状态，再恢复Run、Journal投影与outbox；模型、渠道发送和独立分析仍关闭。
7. 发布ready并开放核心准入，启动被启用的分析工作者及渠道连接，随后调度可恢复的已受理工作。恢复队列不通过插件注册回调偷偷启动。

注册顺序不等于依赖就绪：清单按拓扑校验，接口提供和依赖回调允许分开绑定。核心与记忆的端口协作不能被错误判为包导入环；真正的服务就绪循环必须在activate前报出依赖链。

### 4.3 旧启动方式兼容

核心、记忆与渠道新增 `lifecycleMode: 'legacy' | 'managed'`，默认legacy，旧脚本和外部v2调用不必立即改动。新Host强制managed；不允许配置覆盖为legacy后绕开屏障。

legacy继续保持当前注册后恢复、原会话处理与旧API行为。managed通过显式生命周期执行相同业务步骤；不得复制两套记忆／会话实现。测试同时验证默认legacy和managed两种路径。

managed核心在ready之前，`ingest/submit/acceptWake`返回 `HOST_NOT_READY`，不写一个虚假的已受理回执。外部连接此时尚未开启。已持久accepted消息则保留，统一开放后处理。

### 4.4 关闭、异常与占用

关闭先关闭准入并停止渠道接收，再停止新分析／任务调度，等待既有Run与发送收尾，刷新DSH与outbox，然后关闭提供者、核心和DSH。不能先注销memory再等待依赖它的运行结束。

默认排空期限30秒，可配置；超时请求合作式取消，留下interrupted或uncertain证据。不能把一个尚未结束的外部动作标成已安全取消。Host失败只释放本次取得的资源，不停止别的项目实例。

占用检查使用解析后的路径身份、agent/profile绑定、PID和随机nonce。路径别名、大小写或目录联接不能使同一数据目录同时被占用。PID仍存在或身份不能可靠确认时保守拒绝；不通过删除锁文件强行接管。QQ仍维持已有账号单消费者约束。

## 5. 配置、入口与诊断

### 5.1 配置Schema v1

根字段冻结为 `schemaVersion/profileId/agent/paths/modelRoutes/plugins/runtime/persona/context/authorityPolicies/diagnostics`。未知字段拒绝，路径相对配置文件目录解析；支持显式外部数据路径，但必须记录其真实身份。凭据只使用既有DSH凭据服务引用，不复制凭据文件。

| 配置项 | 第一阶段规则／默认 |
|---|---|
| agent.id | 必填；必须与既有库身份一致；改变值不等于迁移 |
| persona.fixedFile | 保留配置字段；含义细化为身份与稳定底色文件，不放动态人格／私人记忆；test／formal分别标识，正式文件按新方案后续新建 |
| paths | 显式指向core、memory、sessions、query、可选channel数据；不默认覆盖旧`.runtime/phase2` |
| modelRoutes.chat | provider、model、reasoningEffort明确配置并保存版本；不在运行中跟随桌面默认值悄悄改变 |
| modelRoutes.probes | 可选视觉／ASR／声音事件服务引用，仅用于显式探针；未配置如实记录 |
| runtime.maxConcurrentRuns | 默认2，包含前台与后台；至少保留前台处理机会 |
| runtime.maxConcurrentPerTask／Session | 第一阶段固定1；独立任务／会话可以并行 |
| runtime.maxPendingRuns | 默认100；超额明确未受理，不丢弃已受理任务 |
| runtime.turnTimeoutMs | 沿用600000；控制一次运行时间，不是调用次数上限 |
| runtime.shutdownGraceMs | 默认30000；超时进入可核对的中断状态 |
| context | 沿用现有16000字节受控预算、1000000字节请求上限、5000ms准备超时；显式配置压缩输入预算 |
| persona.growthRegion | `memory:growth`，默认4000字节、优先级400、可为空；计入既有总预算 |
| authorityPolicies | 原生任务允许的操作／来源与程序生产者；没有规则不授予跨场景读取或外部写入 |

资源默认值是本阶段实施起点，需按固定工作负载验收并记录调整；不恢复每轮调用次数限制。最小测试配置可关闭记忆，但无TaskRepository或GrowthProvider时必须明确撤下相应功能；完整阶段1验收配置要求timeline、memory及任务端口就绪。

首版Host内建允许的插件清单，将配置中的pluginId映射到已安装且锁定的包与配置Schema。配置不接受模型生成的任意import路径或自动安装指令。配置涉及的包版本、特性、路径和生效值进入脱敏diagnostic manifest。

### 5.2 拟提供的本地入口

| 命令（设计名，尚不存在） | 行为 |
|---|---|
| `dafeiyu-host inspect --config <file>` | 只读检查配置／依赖／数据身份；不调用模型、不开QQ、不自动迁移 |
| `dafeiyu-host init --config <file>` | 仅初始化明确的新空数据目录；已有未知文件拒绝覆盖 |
| `dafeiyu-host migrate plan/apply/verify --config <file>` | 分别生成迁移清单、执行已固定计划、核验；不与start隐式合并 |
| `dafeiyu-host start --config <file>` | 独占启动managedHost；Ctrl+C按排空流程关闭 |
| `dafeiyu-host run --config <file> --request <file>` | 独占的一次性本地原生任务驱动，结束后关闭；活动Host存在时拒绝，不启动第二个实例 |
| `dafeiyu-host status --config <file>` | 读取带时间与实例身份的脱敏快照；标明是否过期，不将文件存在当作在线 |

`run`请求文件只包含业务目标、允许的输入引用、请求ID及受限策略选择；执行身份由本机受信Host签发。未来在已运行Host中提交任务，由原生ExecutionPort接入；第一阶段不新增跨进程远程控制协议。

启用真实QQ仍需显式账号配置与现有独立测试环境。Host不会自动接管正在运行的QQ测试实例。旧demo和qq脚本保留，另新增Host模拟验收入口，不把旧脚本静默改成生产启动。

### 5.3 健康状态

健康快照至少包含profile／agent／hostInstanceId、配置哈希、记录时间、Host状态、插件特性和健康、数据schema、准入开关、队列数、活动Run、outbox积压、故障码。不得写入成长正文、原始任务材料或凭据。

无activity或media实现时显示disabled／not-configured，不报告它们正常运行。必需提供者故障暂停相关准入；可选提供者故障撤下对应工具并显示degraded。状态读取不额外创建DSH Agent。

## 6. 扩展协议与兼容接口

### 6.1 明确区分v2与v3入口

保留现有 `API_VERSION=2`、`registerExtension(Extension)` 和所有v2类型导出。新增 `EXTENSION_PROTOCOL_VERSION=3`、`registerExtensionV3(ExtensionV3)`，公共类型可通过 `@dafeiyu/contracts/v3` 导出。包版本在实际实现发布时确定，本次不提升版本。

两个入口使用同一内部注册表。扩展ID、动作名、渠道账号及唯一提供者跨版本去重；不得注册一个v2和一个v3同名插件绕开互斥。元数据、Schema与回调绑定在注册时固定，卸载使该实例的旧句柄失效。

| 旧接口 | 真实聊天Run | 无聊天Run |
|---|---|---|
| v2字符串参数ActionCapability | 按旧Schema与原会话授权调用 | 不暴露；强行调用返回`UNSUPPORTED_EXECUTION_ORIGIN` |
| v2 ContextContributor | 使用真实conversation／sourceMessageId投影 | 不伪造ContextRequest；不装配该贡献 |
| v2 ChannelCapability | 保持原文字接收／交付与回执语义 | 不作为任务运行的必要依赖 |
| v2 TaskWorkspaceProvider | 原控制器和工作票据继续有效 | 仅由受信TaskRepository适配器使用不依赖聊天的create/read/update等方法 |
| v2 Memory／SourcePolicy | 旧记录和旧会话正常读取 | 不能靠填一个`local`会话调用；使用v3执行服务 |
| v2 D2／D3 | 原模拟行为与旧约束保持 | 本阶段不调用，不补出主动／真实交付 |

新的v3注册信息固定包括：`protocolVersion:3`、`id/version/agentId`、`provides/requires`、独立的`actions/channels/contexts`及生命周期引用。没有channels的v3扩展可以提供actions；不因缺渠道被拒绝。所需未来特性未实现时明确拒绝该配置。

### 6.2 v3操作与结果

本阶段v3操作接受严格JSON Schema的对象、数组、字符串、数值和布尔值；媒体仅预留受管理引用类型，不声明已经具备媒体处理。边界校验由核心与插件分别完成，未知字段拒绝。

操作声明 `effects=read/local-write/external-write`、输入／输出Schema、版本、所需特性。默认内部任务策略只允许明确配置的只读操作与记忆等本地状态操作；不注册终端、任意文件管理或真实外部发送能力。测试可使用有计数回执的虚构副作用能力验证恢复。

统一结果形状为：

```typescript
interface ActionOutcome<T> {
  status: 'succeeded' | 'partial' | 'failed' | 'cancelled' | 'unknown';
  effects: 'none' | 'confirmed' | 'unknown';
  completeness: 'complete' | 'partial' | 'unknown';
  data: T | null;
  sources: readonly ExecutionSourceRef[];
  receipts: readonly OperationReceipt[];
  errorCode?: string;
}
```

来源引用与回执由受信操作端口核验；模型自报成功不生成回执。JSON结果可以投影为文字，但来源／副作用元数据仍以结构化形式进入记录和准入检查。结果过大时明确返回可分页引用或容量错误，不能截断JSON后继续当作完整结果。

### 6.3 稳定错误分类

首批错误码包括 `HOST_NOT_READY`、`DEPENDENCY_UNAVAILABLE`、`INCOMPATIBLE_PROTOCOL`、`UNSUPPORTED_EXECUTION_ORIGIN`、`INVALID_INPUT`、`SCOPE_DENIED`、`VERSION_CONFLICT`、`IDEMPOTENCY_CONFLICT`、`SOURCE_STALE`、`CAPACITY_EXCEEDED`、`TASK_NOT_ACTIVE`、`RUN_INTERRUPTED`、`OPERATION_UNCERTAIN`、`MODEL_INCOMPLETE`、`MODEL_PERSISTENCE_POLICY_UNSUPPORTED`、`SCHEMA_UNSUPPORTED`、`MIGRATION_REQUIRED`、`PERSISTENCE_FAILED`。

返回code、状态与关联ID；不返回原始异常、凭据或无权读取的内容。无访问权与对象不存在沿用相同可见分类。网络故障、结构校验失败和模型保真拒绝不能混写成同一种“成功识别反例”。

## 7. 执行、任务仓储与来源接口

### 7.1 本阶段冻结的核心类型

下列为拟实现类型；`TaskRef/RunRef/ExecutionGrant`是核心签发的不透明对象，ID可持久保存但不能单独作为授权。真实DTO均须对应严格Schema，下面省略品牌类型和通用错误联合。

```typescript
type RunOrigin =
  | { kind: 'message'; inboundId: string; conversation: Conversation }
  | { kind: 'native'; producerId: string; requestId: string }
  | { kind: 'wake'; producerId: string; scheduleId: string;
      scheduleVersion: number; occurrenceId: string; dueAt: string }
  | { kind: 'continuation'; parentRunId: string; checkpointId: string }
  | { kind: 'maintenance'; producerId: string; requestId: string };

type ExecutionScope =
  | { kind: 'conversation'; agentId: string; route: string }
  | { kind: 'task'; agentId: string; taskId: string; scopeKey: string };

interface ExecutionContextV3 {
  readonly agentId: string;
  readonly taskId: string | null;
  readonly runId: string;
  readonly operationId: string;
  readonly origin: RunOrigin;
  readonly scope: ExecutionScope;
  readonly intentVersion: number;
  readonly grant: ExecutionGrant;
  readonly signal: AbortSignal;
}
```

新增native来源用于区分受信本地任务请求与记忆维护任务，是总方案示意类型的细化；调用者不能通过任务文件自行声明native权限。`intentVersion`映射已有Task的epoch；Task.version用于记录变更竞争，二者不能混用。已有任务增加无关证据不必使当前固定输入Run失效，但目标／状态epoch变化必须使旧工作退出。

内部scopeKey固定编码为 `JSON.stringify(['dafeiyu-scope-v1','task',agentId,taskId])`。它不是Conversation，不进入`journal.conversations`，也不能经过`conversationKey`伪造一个QQ／local聊天。旧route原样保留。公共资源SceneRef的完整使用在后续阶段接入，本阶段只实现内部任务文字来源及既有受权会话证据。

task scope必须具有非空且一致的taskId；只有尚未关联持续任务的普通conversation Run允许taskId=null。需要任务的能力声明`requiresTask=true`，准入时校验。这样新v3能力也能处理普通聊天，而不为每一句话制造长期Task。此处是对总方案示意接口的明确细化。

核心的私有授权表把上下文对象绑定插件实例、Run、操作定义、目的、读取来源、允许写入、政策版本和有效期。模型参数中没有agentId、scopeKey、grant或执行器身份覆盖字段。复制对象、借用其它插件的上下文和结束后调用均拒绝。

### 7.2 原生ExecutionPort

| 方法 | 请求与结果 | 语义 |
|---|---|---|
| `submitTask(input, producer)` | requestId、title/goal或TaskRef、明确输入引用、受限policyId→TaskRef、RunRef、状态 | producer由Host或当前受信核心调用绑定；先持久受理再确认 |
| `status(runRef)` | 可见状态、版本、DSH结果引用、操作／记忆回执摘要 | 不返回未获准的完整Task私有快照 |
| `cancel(runRef, request)` | requestId、expectedVersion、reason→取消状态 | 不撤销已经发生的副作用 |
| `pause(runRef, request)` | 同上→waiting或待排空状态 | 本阶段只支持显式暂停，不提供定时器 |
| `resume(taskRef, request)` | requestId、父Run、检查点、当前Task版本→新RunRef | 重新核验来源和权限；不让旧Run重新进入running |
| `acceptWake(input, producer)` | 固定occurrenceId、计划ID/版本、到期时间和原因引用→原／新RunRef或拒绝 | 需受信WakeAuthorityProvider；本阶段仅测试生产者，无真实调度器 |

受理新的Task和Run跨两个库：先在runtime请求账本保存固定请求身份及请求参数指纹，再以派生稳定requestId调用TaskRepository.create；取得或查回原TaskID后，在runtime同一事务保存Run与受理回执。中途重启继续补齐同一请求，不创建第二个Task或Run。请求尚未完成时返回pending，不虚称已启动。

已受理消息建立Run时以原inboundId作为唯一绑定；原始入站事实仍由Journal权威保存。Task型运行必须具备TaskRef；单纯聊天的执行帧可以只绑定inboundId，不能为兼容所有聊天而自动制造长期任务。普通v2聊天继续用旧ActionContext；不要求Task的v3动作使用conversation上下文。若聊天需要持续任务或`requiresTask`能力，先建立／选择Task再签发对应上下文。

### 7.3 TaskRepositoryPort与内存句柄

本阶段端口包含 `create/readState/readSelectedInputs/update/findRequest`，全部经核心受信控制器调用。复用现有TaskWorkspace的ID、版本、epoch、目标与状态；先以兼容适配器实现，不把Task正文搬到runtime.sqlite。

原有v2 `task_jobs/task_slots`保持旧格式和旧工作票据语义；新内部Run不向其严格Conversation字段塞入假值。本阶段用v7的执行结果绑定保存Run结果引用和输入证明，暂不承诺新的异步跨插件WorkTicket API；后续需要时另行演进。已有v2并发槽、迟到和删除测试继续通过。

恢复时先按旧规则把遗留v2 running工作标为interrupted，再恢复新Run。新Run持有当前TaskRef和新签发的权限，不复活旧内存票据。Task完成后不再执行新动作；既有D2/D3完成材料按原语义处理，本阶段不扩展完成后真实交付。

### 7.4 ExecutionMemoryPort与文字来源

端口提供 `recordObservation`、`contribute`、`openSource`、`selectEvidence`和`prepareContext`。参数包括requestId、固定Run来源、文字材料／片段范围、实际曝光、选择依据和来源版本，核心补齐权限与生产插件身份。

`ExecutionSourceRef`固定agent／task／run／sourceId、scopeKey、version、contentHash与内容性质。来源记录可以是原生输入、能力实际结果或其明确派生摘要；模型输出不能自报为原始平台事实。普通聊天的v2 SourceRef不改变。

新task范围第一阶段支持精确来源回查、已选证据与贡献读取，不承诺已经接入该新范围的全量语义索引或独立分析。跨场景检索继续通过现有D1端口在原获准场景中执行；旧分析工具不被伪造上下文复用。相关范围扩展随记忆E及后续消费者单独验收。

本阶段的内部观察默认 `internalUse=task`、`externalExpression=none`。旧会话记忆经既有D1稳定规则和任务授权选入，规则缺失时拒绝；不得为让演示通过生成默认全局授权。贡献提交保留实际输入依赖，不因为改写成摘要而获得对外表达范围。

文字观察、选中贡献和记忆outbox在memory库同事务提交；Run只保存回执引用。贡献失败时实际能力结果仍可归档并如实报告，不能重做能力来“补一次记忆”。读取错误与无来源候选不能退化为模型自造事实。

### 7.5 唤醒接收边界

`WakeAuthorityProvider`只提供检查计划当前版本、状态、所属智能体与有效期的受信查询；不负责在核心里运行计划。缺少该提供者时，真实wake入口为not-configured。测试生产者在独立测试配置中注册固定计划和可控时钟，不能由运行数据里一个任意JSON文件冒充。

去重键为 `(agentId, producerId, occurrenceId)`，保存计划版本与参数指纹。相同机会重投返回原Run；变更参数报冲突。准入后、开始执行前再次检查计划有效性。将来activity负责定时和outbox；本阶段只交付可被它使用的接收端口。

## 8. 稳定底色、阶段人格与连续性

### 8.1 身份与底色快照

正式底色依据[人格成长与连续性方案](persona-growth-continuity-plan.md)后续新建，由Host显式绑定；不采用用户已拒绝的管理中心人格文件，不恢复旧私人历史。底色包含身份与形象的已定部分、爱世界、好奇、独立判断及诚实面对事实与未知，不预填大量爱好、经历、固定情绪或讨好要求。爱世界允许针对具体恶意回避、反驳和结束互动，平台权限另行约束。

managed运行读取明确配置的UTF-8底色文件，检查非空、合法编码及32000字符上限，并计入实际请求预算。文件身份、文本哈希及装配版本固定在Run；底色变更从下一Run生效。文件无效时拒绝新Run，不回退为测试人格。普通成长接口没有底色写入权限。

保留`PersonaSnapshot {text,version}`和`persona.fixedFile`兼容名称；新增独立`PersonaManifestV1`绑定阶段、选择、检查点、来源、政策与模型版本，不改旧不可变快照含义。当前`persona.test.md`继续仅用于虚构测试；新正式底色尚未创建和验收。

### 8.2 阶段状态与GrowthProvider

阶段人格以memory中的认识和证据为权威，允许为空、暂定或保留分歧。GrowthProvider保留`select/prepare/validate/status`；新增PersonaGrowthPort的显式候选、复核、发布和撤下语义，及ContinuityPort检查点。阶段聚合保存条目引用与版本；growth_selections保存场景选择，所有写入通过同一提供者协调，不能形成两套竞争状态。

本阶段实现受信请求或当前大肥鱼明确提出的候选／选择路径、trial／adopted／withdrawn等版本状态和原子发布；日常状态更新不增加逐项人工审批。自动从全库经历归纳兴趣、关系、经验的算法仍是整体阶段3的记忆E。held表示证据不足或需要比较，不自动表示人工审批。

运行中经`memory:growth`装配适用于当前场景的条目，统一接受总预算、版本和来源校验。阶段人格、当前临时状态、任务要求分开；成长正文不升级成权限规则。私有材料抽象为性格描述也必须继承实际输入限制，不能因agent所有权而对所有群可见。

### 8.3 任务动机、异议与自主选择

大肥鱼在兴趣、偏好和看法上可坚持自己的判断，并接受新证据纠正；明确任务按要求认真执行。偏好不同不阻塞任务，方法建议不暗改目标，根本前提错误／缺少关键信息／越权只阻塞相关步骤。用户明确保留可行且已授权的原方案后，继续执行。普通聊天仍可无Task。

业务动机与RunOrigin分别保存。指定观看、受托立场写作及用户称赞交付质量，不能直接写成大肥鱼的偏好／信念；真正产生的新兴趣可以提出候选并保留起因。TaskIntent记录关联原Task及epoch；任务目标仍由原仓储权威保存，实质要求变更推进epoch。时间／资源竞争在activity阶段实现真实调度，本阶段验证受信任务与脚本活动的边界。

### 8.4 更新、失效与压缩接续

新阶段版本默认下一Run使用，当前Run固定采用清单；新增无关条目不全局失效。当前采用条目被撤下、来源更正／删除或权限收紧时，相关上下文、摘要及未提交结果立即失效，不能等待整理任务。恢复和阶段回退都产生新版本并重新验证，旧证明不复活。

压缩保护任务、约定、未决问题、反证、临时条件和实际效果；连续性检查点只保存有范围引用及必要说明，不复制完整聊天或思考。重启加载权威底色和当前有效阶段，再验证Task、来源、权限和DSH位置；未知效果不重放，缺失原文不猜回。跨隐私域只重建合法视图。

第一阶段采用人格方案PGC-01—PGC-27中标注1E／1G的部分验收；自动关联、真实调度及长期成长项目按各自阶段验收，不能合并宣称通过。完整样本协议见该方案第12—13节。

## 9. 无聊天消息的Run与DSH适配

### 9.1 ExecutionFrame

将DshRuntime内部入口改为接收ExecutionFrame，明确 `mode=conversation/task/delivery-v2`、sessionId、Run或入站身份、origin、scope、人格快照、模型路由、输入引用及准入守卫。旧`run(PendingMessage,...)`保留薄适配入口或在本仓库同步迁移调用点，行为保持。

task模式只从任务仓储和固定输入引用取得目标／材料，不构造假的PendingMessage、sender、message_id或Conversation。模型完成只返回内部RunResult；没有自动调用channel.deliver的路径。

聊天模式继续向原DSH会话处理；D3模拟人格整理沿用原目标会话及禁用工具规则。三种模式共享AgentHandle生命周期、工具注册、来源检查与预算实现，避免复制模型运行循环。

### 9.2 程序来源与持久化

扩展DSH `MessageSourceMap`注册 `dafeiyu-execution`，包含 `kind/form:'notice'/summary/taskId/runId/inputId/originKind`；summary使用DSH的120字符边界，不泄漏内部目标到公共诊断。DSH传输仍可使用user-role内容块，但来源kind明确为程序生产者，不是人类用户。

程序输入与任务状态作为有来源的数据，不授予更高权限。模型或网页文本不能伪造这些元数据。先在独立DSH会话验证保存、重开、查询、压缩和来源回查；若当前DSH版本不支持完整持久路径，暂停该实现项并修订适配方案，不降级成source.kind=user伪装通过。

同一Task／epoch／隐私域使用明确的DSH任务会话映射，连续Run可恢复该会话；同会话同时只允许一个Run。权限范围收窄或用途改变时创建新的隔离会话，从当前有效检查点重建，不把旧完整历史复制过去。不同任务不共享一个无限增长的后台会话。

### 9.3 上下文与来源检查一起演进

ContextCoordinator新增v3准备路径，输入ExecutionView而非PendingMessage；v2贡献只在conversation模式经真实来源投影调用。SourcePolicy新增run-input、execution-source、growth的依赖类型，继续执行版本、哈希、删除与当前授权检查。

FeedbackRuntime与CompactionRuntime采用同一ExecutionFrame／scope适配。新内部文字工具反馈以Run来源引用记录；不强行调用需要旧ActionContext的反馈归档工具。已有聊天反馈和旧摘要按原格式读取。

task模式复用现有纯文字摘要策略与来源退出机制；无有效来源策略时拒绝使用该摘要，不把它当普通无来源文字。旧摘要证明的route、seq、hash和版本不可重写。所有升级后的解码器显式支持旧／新格式，不以宽泛`any`跳过校验。

新增人格／连续性适配同时保留任务动机、未决异议、偏好依据、反证及缺口。压缩后不重新估计“她原本是什么人格”，而是读取当前有效阶段并组合合法历史；试行意见不能在摘要中被改写成稳定信念。

### 9.4 模型流与内部思考

managed任务在DSH持久化前仅保留可见文字、合法工具调用／结果、用量、结束状态和必要来源元数据；reasoning及包含内部思考的opaque replay不写业务或DSH持久文件。过滤需保持流索引与工具调用配对，不破坏真实多步工具调用。

某路由若必须依赖只能通过持久化内部思考才能恢复的状态，标记`MODEL_PERSISTENCE_POLICY_UNSUPPORTED`，不能为了让测试通过悄悄放开记录。允许由DSH适配器管理确有需要的进程内临时传输状态，必须验证关闭后不落盘；不为此另写模型循环。

当前legacy会话历史不回溯删除或重写。新managed聊天和任务应通过相同的持久化政策核验。真实路由多步工具调用及重启后的正常续轮是前置探针之一，模拟模型不能替代。

### 9.5 Run状态和暂停／恢复

| 状态 | 转移／恢复规则 |
|---|---|
| accepted | 请求和Run已持久化；可以排队或在政策失效时拒绝 |
| queued | 等待资源；开始前再次核验Task epoch、权限、来源及提供者 |
| running | 已记录执行快照并准备调用DSH；进程中断后变interrupted，不自动重跑 |
| waiting | 显式暂停完成；保存检查点，本阶段只接受原生显式resume |
| cancelling | 请求取消，等待DSH及工具收尾；不能提前宣称无副作用 |
| completed | 结果已flush并保存引用；不等于记忆贡献或对外发送全部成功 |
| failed／cancelled／interrupted | 终态；继续工作创建关联的新Run，不把旧状态改回running |

暂停在工具结束等可持久检查点执行；若DSH正在等待平台调用，先得到结果或记录unknown。模型选择不执行任何能力、给出内部结束说明也是合法完成，不强制产生观察／记忆／发送。自主改期和定时休息策略由阶段4接入。

Run并发默认2，同Task／DSH会话串行。前台有保留处理机会，后台等待时间进入优先级评估；不在持有SQLite事务时等待模型或网络。取消信号传播到模型、能力与上下文准备，关闭时等待它们释放引用。

## 10. Run账本、旧聊天状态与跨库一致性

### 10.1 runtime v1基础与v2人格清单

新库由核心管理，具有明确application_id、schemaVersion、agent／profile身份和占用信息。只有明确的新空库可初始化；未知同名文件拒绝。

| 表（拟定名） | 主要字段与约束 |
|---|---|
| `runtime_metadata` | schema、agentId、profileId、创建版本；身份不可静默修改 |
| `execution_requests` | producerId＋requestId唯一，参数指纹、不可变请求体、受理阶段、taskId／runId、回执；用于跨库补齐 |
| `runs` | runId主键、taskId可空、scopeKey、origin、Task epoch、状态／version、sessionId、快照引用、检查点、结果引用、错误码与时序 |
| `run_inputs` | runId＋inputId唯一，来源定位、版本、哈希、用途及依赖证明；正文仍由来源库／DSH持有 |
| `execution_sessions` | agentId＋任务或会话身份＋epoch／隐私域唯一→DSH sessionId；不得跨范围复用 |
| `run_operations` | operationId主键，runId＋逻辑操作键唯一，DSH toolCallId、插件／动作版本、输入指纹、开始／结果状态、effects、回执引用 |
| `run_checkpoints` | checkpointId、runId、DSH已flush位置、已完成操作清单、未知副作用、来源版本与授权版本 |
| `wake_receipts` | agentId＋producerId＋occurrenceId唯一，计划版本、参数指纹、runId或拒绝回执 |
| `runtime_outbox` | 稳定eventId／commandId、目标、不可变消息、投递状态；与对应Run变更同事务 |

Task定义仍在memory的现有task_workspaces／task_revisions。runtime的原始请求体用于幂等和未完成受理恢复，不是可编辑的第二份Task目标；Task建立后以其当前版本为权威。Run结果保存DSH引用及哈希、选中来源与各模块回执，不另建完整聊天历史。

Run引用不等于操作权限。恢复后重新签发进程内句柄并核验政策；旧句柄不从JSON反序列化复活。输入、回执和检查点的可见范围与其Run一致，不能通过status返回全库正文。

1C的runtime v1及上表基础不倒改。本修订在1E增加runtime v2迁移与`run_persona_manifests`：runId唯一关联、版本化清单及哈希，与新Run开始同事务固定底色、阶段选择、来源／授权、连续性检查点及装配版本。旧Run保留原快照并明确legacy-unbound，不补造当时的人格；新managed Run缺少清单不得进入running。

### 10.2 操作与结果的落盘顺序

1. 保存queued Run及固定输入；工作者独占领取并写入running、人格／模型／插件快照。
2. 每次能力操作先写operation.started及其稳定身份，再调用能力；调用后保存结果／副作用状态和回执。结果归档失败不能解释为未执行。
3. DSH完成后先flush其会话，再将结果引用／哈希、Run completed及需补投的领域事件同事务保存。
4. 需要记录任务知识结果时，用runId派生稳定请求ID调用memory执行结果绑定；成功后保存确认。重复补投不形成两份结果，失败时显示记忆结果待归档，不重新运行模型。
5. 内部任务到此结束，不进入渠道发送。聊天模式另按下一节连接原Journal与交付状态。

DSH与SQLite不存在跨库事务。DSH已经写入而Run结果提交失败时保持interrupted／待核对；不得通过扫描到一句助手文字就自动认定可再次执行或发送。人工／原生恢复需检查完整turn结束、来源与操作记录。

逻辑操作键绑定同一次已受理调用，不对所有相同参数做全局去重；同一Task明确进行第二次读取仍可执行。恢复旧工作时只有可验证检查点中的步骤能续接；有未知副作用时阻止相应重复动作，不能由模型换一个requestId消除事实。

### 10.3 managed聊天兼容的桥接协议

Journal仍权威保存入站与普通回复状态；runtime只权威保存本次模型执行。两者通过inboundId与RunId关联：

| 阶段 | 规定顺序／故障恢复 |
|---|---|
| 新入站 | Journal先按原事务accepted；派生稳定受理ID在runtime建立唯一Run；未绑定成功可重试绑定 |
| 开始模型 | Run领取并固定快照→Journal由accepted转processing→写Run执行开始检查点→调用DSH；中途崩溃保守中断，不再生成第二轮 |
| 模型成功 | DSH flush→Run completed＋结果投影outbox→Journal reply-ready；跨库丢确认只补投结果，不重跑模型 |
| 模型失败 | 保存Run失败与实际操作状态→幂等投影Journal failed；原工具副作用保持 |
| 原交付 | 继续使用旧reply-ready→sending→delivered／uncertain机制；不把投递失败当成Run需要重做 |

恢复时先查是否有已提交Run结果可幂等补齐，再对缺少可信结果的processing执行旧uncertain规则。不能先把所有processing标为uncertain，再尝试补录已确定结果。补投必须校验Run绑定、原状态、DSH结果哈希和目标，不能覆盖已经sending／delivered或被更正的意图。

旧数据库里的记录若没有Run绑定：accepted在全部插件ready后可按原规则处理一次；reply-ready直接恢复原交付，不调用模型；processing／sending保留uncertain；delivered／failed／uncertain不补建可执行任务。迁移不为全部旧聊天批量制造Run。

### 10.4 事件模型

Journal schema v2保留原events表及旧body；新增严格的ExecutionEvent解析／追加入口和索引。旧conversation事件仍按schemaVersion=1写读，新任务事件使用schemaVersion=2和visibility.kind=task，route列仅存内部scopeKey兼容索引。

`events(route)`等旧接口继续只提供旧会话语义；新`executionEvents`接受核心签发的task范围。不能把“填同一个route字符串”当成task读取授权。事件至少记录taskId、runId、operationId、causedBy、来源引用、发生／记录时间和schemaVersion。

旧私有agent-task route事件保持原身份和可见规则，不批量改成v2，也不把它们当真实渠道会话创建入口。mixed schema读取显式分支校验；未知版本失败，不用类型断言假装所有事件仍是v1。

## 11. 数据迁移：本阶段具体范围

### 11.1 版本清单

| 数据 | 本阶段目标 | 处理方式 |
|---|---|---|
| journal.sqlite | v1→v2 | 增加身份／迁移记录及task事件支持；原ID、seq、body、inbox和回执不重写 |
| memory.sqlite | 1C：v6→v7已实现；1E：v7→v8拟增量 | v7执行来源／成长选择表保留；v8增加候选、阶段聚合、依赖、检查点及TaskIntent旁表；旧记忆不改写 |
| runtime.sqlite | 1C：新v1已实现；1E：v1→v2拟增量 | 保留Run账本，增加本轮人格采用清单；不导入全部历史聊天 |
| DSH JSONL | 沿用DSH格式 | 添加新生产者来源与执行映射；原sessionId／seq／消息不改写 |
| delivery.sqlite | 保持v1 | 旧D3模拟意图及凭据不迁移为真实／主动发送 |
| analysis／working／feedback.sqlite | 保持各v1 | 旧聊天分析／工作／反馈继续使用原路径；无消息Run不伪造旧调用；通用迁移留待实际消费者需要 |
| retrieval.sqlite | 保持v2 | 既有授权场景召回与缓存继续用原分区；第一阶段不增加全库／新scope语义索引 |
| qq.sqlite | 保持既有结构 | 只调整生命周期，不重建消息、handled或回执；显式schema门禁在QQ后续方案中实施 |
| activity／media／B站库 | 不创建 | 本阶段没有对应正式实现；探针使用独立临时目录 |

总方案列出的后续schema版本不是本阶段一次全部升级的要求。第一阶段只对实际使用的权威格式做增量迁移，并为未来端口保留特性协商。

### 11.2 memory v7的增量表与解析规则

| 新增表／能力 | 语义 |
|---|---|
| `execution_scopes` | scopeKey、agentId、taskId、类型、当前授权／状态元数据；内部范围有明确身份 |
| `execution_sources`与状态／版本记录 | Run输入或能力文字结果、来源种类、正文哈希、生产者、实际输入依赖；正文不可覆盖，删除／恢复推进状态版本 |
| `execution_observations`／贡献关联 | 观察批次、处理／曝光清单、选择结果、幂等请求；保留不贡献的活动事实 |
| `growth_selections`、`growth_revisions`、`growth_requests` | 按用途／scope保存有版本的记忆选择引用；不复制一份可编辑成长正文 |
| `task_execution_results` | taskId＋runId唯一，DSH结果引用、Task epoch、输入证明、采用状态；不竞争旧task_slots |

新内部贡献仍进入既有memory_items／memory_revisions，来源联合增加execution-source；对应boundary使用明确版本2的task内部范围。现有boundary v1及其哈希原样保留，旧v2调用不默认读取新task范围。新格式只允许核心生成范围，不能由模型提交boundary JSON。

原记忆内的route列可以保存新的规范scopeKey作为存储分区，但读取必须先验证boundary和ExecutionScope，不能把任意分区字符串视为Conversation。来源依赖、更正、删除恢复与outbox继续使用原事务边界；新记录缺少可验证来源时拒绝。

1C已将MemoryStore和`migrateMemoryBoundaries/migrateObservations/migrateTaskWorkspaces/migrateTaskMemory/migrateExpression`等辅助迁移的识别范围推进到v7；1E必须同步支持v8。保留原v1→v7迁移及历史记录，新增v7→v8，不能只改PRAGMA或在原v7脚本里偷偷补结构。

v8的拟新增表、字段不变量、跨库顺序和旧Run处理详见[人格方案第10节](persona-growth-continuity-plan.md#data-evolution)。旧growth选择不会自动提升为稳定人格，旧动机保持unknown；人格字段不写入旧Task严格JSON，TaskIntent通过旁表引用原Task／epoch。

### 11.3 预检、备份与执行步骤

1. inspect直接以只读方式读取文件身份、schema、表／触发器清单及占用，不调用有自动迁移副作用的Service构造器。输出计划与缺失项，不读取／打印凭据或私人正文。
2. 迁移清单固定源提交、目标协议／schema、配置映射、路径真实身份、数据库身份及迁移ID。apply前重新核对，变化则拒绝旧计划。
3. 关闭接收、Run／分析准入，排空并flush DSH及数据库，确认无第二个写者。活跃数据不能仅复制主`.sqlite`文件当备份。
4. 对所有关联权威库、DSH文件和必要配置映射取得一致性备份；记录校验值、时间、水位及恢复方法。备份不入Git。
5. 按已核定的journal→memory→runtime顺序执行分库事务；在1C基础上，1E新增memory v7→v8、runtime v1→v2步骤。跨库进度写入migration manifest，包含planned／applying／applied／verified状态。新目录通过显式init建立，不在start中静默初始化未知文件。
6. 检查quick_check／foreign_key_check、旧ID／版本／哈希／墓碑／回执／session映射，以及允许的新增表和计数。新Run库应没有凭空出现的可执行历史任务。
7. 关闭外部输入进行managed恢复演练，再打开准入。首次开放后的新写入水位单独记录，以区分可恢复迁移前备份的窗口。

每一步可重复核验；重复apply不会重复迁移或创建空库覆盖。未知表结构的旧Journal、错误agent/profile绑定或未来schema明确拒绝。路径别名及迁移中断测试必须使用Windows实际路径语义。

### 11.4 保留与回退

不改旧不可变JSON、来源哈希、幂等指纹、删除墓碑、任务ID、版本／epoch、scene selection、工作槽、交付凭据及QQ去重标记。不把旧已删除记忆或私有资料变成全局成长状态，不复制／恢复已清除历史。

原`1046653`代码不支持journal v2／memory v7；`685221c`也不支持本修订拟定的memory v8／runtime v2。迁移后不能只按相同包版本号推断可回退写入。尚未开放新输入时，失败可恢复经过核验的整套一致性备份或完成前向修复；已经接受新数据后，必须保留新增记忆和状态，使用兼容读取器／修复版本，不拿旧快照覆盖。阶段人格回退采用新补偿版本，仍遵守当前墓碑和授权。

第一阶段发布需附schema兼容清单和维护模式；没有兼容回退代码时不能标为“可直接自动回滚”。服务器更新守护适配留待部署阶段，不能假设现有守护会迁移或回滚私人数据。

## 12. 异常、取消与诊断原则

| 情况 | 第一阶段行为 |
|---|---|
| 依赖缺失／人格无效／数据版本不符 | 不开放准入；释放本次资源；诊断说明具体对象 |
| open／bind中途失败 | 按已完成步骤逆序清理；不执行模型、旧消息或后台分析 |
| 接收后进程退出 | 已持久请求可补齐受理；已有running Run变interrupted；不能凭请求还在就重做动作 |
| 插件在Run中卸载 | 撤销对应句柄并取消操作；其它独立任务按自身依赖继续 |
| Task epoch或实际来源变化 | 开始前拒绝，执行中停止旧结果提交；无关资料变化不全局清空 |
| 模型失败／流不完整／持久化政策不支持 | 保存稳定错误与已发生操作事实；没有最终成功结果，不自动发送 |
| 能力部分成功或副作用未知 | status、effects、回执分别保存；恢复不重复未知动作 |
| 记忆提交或outbox失败 | 返回真实提交状态，补投固定ID；不能通过重跑工具修复归档 |
| 暂停／取消发生在工具中 | 等待合作式边界或记录unknown；不会提前关闭其正在使用的存储 |
| 正常关闭超过期限 | 留下可核对中断状态，输出排空未完成；不声称所有动作已经取消 |

日志保留配置／插件／协议版本、生命周期阶段、runId、taskId、operationId、事件因果、来源标识和稳定错误。原生任务正文、成长内容和完整结果保存在相应受控存储，公共状态仅提供引用与计数。旧日志不重写，新的纠正通过追加记录表达。

同一轮恢复只对确定状态执行一次补齐；重复失败使用明确的待处理状态，不用忙循环反复调用模型或操作。第一阶段不实现自动活动重试策略，留给activity的后续调度。

## 13. 验收方案与完成门槛

### 13.1 探针必须先于正式实现假设

| 探针 | 验证内容 | 失败后的处理 |
|---|---|---|
| P1-P01：程序来源 | 自定义DSH来源经过followup、持久化、重开、查询和压缩仍保留身份与来源关系 | 不伪造user来源；修订适配并重新验证 |
| P1-P02：模型持久化政策 | 真实路由多步工具调用，过滤reasoning／opaque replay后可正确结束；持久文件不含内部思考 | 记录不支持，调整已配置适配／路由；不放开内部思考记录 |
| P1-P03：图像输入 | 实际图片进入所选视觉通路，回答只有图像包含的信息，记录媒体／模型路由 | 未配置／不支持如实记录，不当成画面能力已通过 |
| P1-P04：真实音轨 | 无字幕语音片段与关键声音事件进入实际音频服务，返回时间对齐证据 | 明确ASR与声音事件缺口，完成可行路径选择；不以字幕替代 |

探针使用虚构／获准的本地样本和独立数据目录，不连接B站、服务器或复用私人聊天。P1-P03/P04只证明可用接口和配置路径，完整媒体覆盖、缓存和平台观看在后续阶段验收。

P1-P01/P02是managed任务真实运行的阻断项。媒体探针未完成时可以记录核心代码的独立测试结果，但不能宣布总方案所列第一阶段前置核验全部完成，也不能降低B站首版音画要求。本次文档任务没有执行这些探针。

### 13.2 确定性与真实DSH集成用例

下表保留初版44项并新增9项人格／任务／迁移用例，共53项；另有上节4项前置探针。已完成探针和子步骤以各自报告为准，本次文档修订没有实施新增用例。人格方案的PGC编号进一步展开跨阶段要求，不替代本表。

| 编号 | 场景 | 必须得到的结果 |
|---|---|---|
| P1-H01 | 插件顺序打乱、缺服务、重复ID／账号 | 拓扑及唯一性检查正确；失败前无工作被启动 |
| P1-H02 | 每个open／bind／recover步骤故障 | 资源逆序释放，无半正常Host，无额外模型／平台调用 |
| P1-H03 | 有accepted消息且memory尚未就绪 | 注册不会触发旧消息；ready后只处理一次 |
| P1-H04 | analysis有排队任务 | managed激活前不启动分析；legacy原行为保持 |
| P1-H05 | Ctrl+C、排空超时、重复dispose | 活动工作持久收尾或明确中断，存储不提前关闭 |
| P1-H06 | 同目录不同大小写／目录联接、同账号两实例 | 第二实例拒绝，不能删除锁抢占 |
| P1-H07 | status快照过期、进程已退出 | 显示过期／离线，读状态不创建Agent |
| P1-C01 | v2原插件加载及完整回归 | 原动作参数、触发、来源和恢复语义保持 |
| P1-C02 | v2动作／上下文进入纯任务Run | 不暴露或明确拒绝，无伪造Conversation |
| P1-C03 | 无渠道v3能力 | 在获准Run内真实被DSH调用，操作和观察有来源 |
| P1-C04 | v2/v3同名、Schema非法、参数越界 | 注册／调用拒绝，不发生副作用 |
| P1-C05 | 克隆上下文、跨插件借用、卸载再注册 | 旧授权失效，错误不泄漏私有材料 |
| P1-R01 | native请求，无QQ／模拟渠道 | 完成Task→Run→DSH→动作→结果，无Journal入站和渠道发送 |
| P1-R02 | 相同请求并发提交及参数变更 | 同参只建一个Task／Run，异参冲突 |
| P1-R03 | Task建成但Run回执未写入时崩溃 | 重启补齐同一Task，不出现孤立重复任务 |
| P1-R04 | 两Task并行、同Task／Session并发 | 独立任务可前进，同Task／Session串行 |
| P1-R05 | epoch变化、暂停再恢复、不同结果 | 旧Run不能提交，新Run重新签发授权和输入 |
| P1-R06 | 不执行能力直接结束 | 合法completed，无虚构观察、记忆或发送 |
| P1-R07 | 工具确认效果后模型失败／进程中断 | 实际效果及回执保留，后续不自动重做 |
| P1-R08 | DSH结果已flush、Run提交失败 | 保守中断，不因发现最终文字自动执行或发送 |
| P1-R09 | Run completed后Journal投影丢确认 | 幂等补成reply-ready，模型不重复调用 |
| P1-R10 | 旧processing／sending没有Run记录 | 沿旧uncertain语义恢复，无自动重放 |
| P1-R11 | 旧reply-ready／delivered | 前者只恢复原交付，后者不发送；不批量创建Run |
| P1-R12 | 取消／暂停时工具不立即响应 | 保留cancelling或unknown事实，不伪称已终止 |
| P1-R13 | 观点、明确任务、邀请、外部引用命令 | 意图与可信来源分别核验；普通交流不被强制建Task，引用不授予权限 |
| P1-R14 | 非阻断建议、阻断异议与用户保留原方案 | 不暗改目标或敷衍；相关步骤等待澄清，实质变更推进epoch，旧结果失效 |
| P1-W01 | 同一wake丢确认后重投 | 返回原Run；修改参数报冲突 |
| P1-W02 | 无WakeAuthorityProvider或伪造生产者 | 拒绝；没有后台定时器被偷偷启动 |
| P1-W03 | 计划版本在排队期间变化／取消 | 开始前拒绝旧机会，已有运行按取消规则收尾 |
| P1-S01 | Task新来源与conversation相同裸ID | 命名空间隔离，不错误取得另一来源 |
| P1-S02 | 新内部结果被普通时间线／v2记忆读取 | 无授权时不可见；不能通过猜scopeKey读取 |
| P1-S03 | 删除来源、恢复、修订及生成中变化 | 旧上下文／结果退出；恢复不复活旧证明 |
| P1-S04 | 未选择内容与实际曝光不同 | 记忆贡献与曝光分别可查，摘要继承实际输入限制 |
| P1-S05 | 私有证据用于不允许的操作参数 | 调用前拒绝，内部使用不扩大出口权限 |
| P1-G01 | 底色修改、无效文件、在运行中修改 | 当前Run快照稳定，下一Run采用有效新版本或明确失败；材料和普通成长接口不能改底色 |
| P1-G02 | 成长选择新增、修订、清空和重启 | 正文权威仍在memory，选择版本保持且生效可查 |
| P1-G03 | 私聊成长资料进入其它群／内部任务 | 分别按表达／内部授权过滤，未授权不装配 |
| P1-G04 | 新无关记忆与已选来源删除 | 前者不全局失效，后者撤下相关依赖 |
| P1-G05 | 工作、成长、证据和原生区域共存 | 同一预算与来源校验，不覆盖DSH原生区域 |
| P1-G06 | 爱世界底色遇到恶意与伤害 | 允许适当回避／反驳／结束互动，不抹去负面事实，不无依据全局否定 |
| P1-G07 | 兴趣分歧、指定观看、受托立场与赞扬 | 独立判断与认真履约同时成立；任务动机和自我认识分开，不自动更新人格 |
| P1-G08 | 显式候选、试行、采用、并发及撤下 | 精确版本和幂等发布，记录证据与反证；held不自动要求人工审批 |
| P1-G09 | 完整／压缩／多代压缩并重启对照 | 承诺、未决分歧、来源、限定与缺口保持；不由摘要猜回人格 |
| P1-G10 | 自述与原事实冲突、旧Run无人格清单 | 以权威来源与回执核验；legacy-unbound不补造证明，恢复不复活删除 |
| P1-G11 | 用户压力、改写、顺序变化及模型自评 | 按固定样本报告波动与失败；自评不直接发布人格，不以一致率／温柔程度判通过 |
| P1-M01 | 既有v1→v6样本升级至v7、journal v1→v2 | 原ID、版本、哈希、墓碑、回执与会话保持 |
| P1-M02 | 分库升级中断、重复apply、计划变化 | 关闭准入，可核验恢复；不重复建库或跳过检查 |
| P1-M03 | 未知库、未来版本、错误profile／agent | 只读预检拒绝，不修改原文件 |
| P1-M04 | 新数据写入后请求旧代码回退 | 拒绝不兼容写入，保留新增状态，不能恢复旧快照覆盖 |
| P1-M05 | 本阶段不变的交付／分析／工作／检索／QQ库 | 身份与业务内容保持，旧数据仍可按原规则使用 |
| P1-M06 | memory v7→v8、runtime v1→v2与半提交 | 旧行／哈希／墓碑保持，新增阶段状态及Run清单原子性可验证；旧代码拒绝不兼容写入 |
| P1-A01 | outbox已写入但确认丢失、事件乱序 | 固定ID不重复，因果与记录顺序可回查 |
| P1-A02 | 日志／JSONL／运行结果扫描 | 不含测试凭据哨兵、内部思考哨兵或未授权正文；保留合法工具结果 |

所有用例使用真实DSH服务测试模块协作；模型可脚本化的部分明确标为模拟。不得删除或放宽既有权限、删除与恢复断言来满足新接口。全部确定性必需用例通过，失败／跳过必须单列，不能合并成“总体正常”。

### 13.3 真实人格与无消息任务验收

使用按[人格方案](persona-growth-continuity-plan.md)新建的最小底色和虚构目标／经历／关系样例，覆盖初次空偏好、爱世界与情境应对、独立判断、任务／兴趣区分、异议、纠正、多轮约定、跨范围表达、阶段撤下和无聊天任务。原始材料不来自私人历史，不复用已拒绝的旧人格文件。

真实运行需证明：原生目标以正确来源进入DSH；模型实际调用无渠道能力；能力返回真实的虚构测试回执；大肥鱼可以选择贡献或不贡献；Run结果落盘，重启后不重复调用。报告区分模型最后说了什么、工具实际做了什么、记忆实际提交了什么。

正式底色与测试人格分别验收。正式评价关注可观察的价值边界、能力诚实性、独立判断与履约、纠正及连续性，不把固定口吻或迎合程度作为通过条件。程序验证来源／版本／隔离／事务，模型评审仅辅助。正式底色未建立、未调用真实模型或缺少规定对照时，相关项标为未完成。

样本规模、改写／压力条件、完整／压缩／重启对照、重复运行、失败保留及门槛统一采用人格方案第13节：162次计划场景运行，关键事实保留率目标至少90%，来源／限定／缺口诚实性及权限等阻断项不得以平均分抵消。该工作量不是运行时调用次数上限；不足必须报告未完成，不静默减少失败样例。第一阶段不据此宣称长期自主成长或主观体验已验证。

### 13.4 资源与验收产物

固定测试目录规模、Task数量、输入大小和并发，在Host空闲、两Run重叠、上下文装配、压缩与关闭期间记录RSS、commit、队列、outbox与p50/p95耗时。沿用总方案2GB组合规划，区分本阶段实际加载的组件与尚未加载的媒体／活动；不凭单阶段内存测量宣布整机部署通过。

阶段1验收报告至少交付：代码提交与版本清单、脱敏配置哈希、依赖／健康清单、L1/L2测试结果、四项探针状态、新底色与阶段状态清单、真实任务／独立判断／连续性对照、评审分歧及全量失败、迁移前后不变量核对、故障演练、资源工作负载、未完成项与回退限制。

代码功能可分批完成，但只有本节必需实现、兼容、迁移和真实验证均完成，才能标记第一阶段完整验收。当前文档完成不能记为任何未来功能用例通过。

## 14. 实施子步骤与文件级改动计划

按顺序推进，前一步的接口／数据约束进入下一步，不同时改动所有持久格式。

| 子步骤 | 主要内容 | 首批文件／产物 | 退出条件 |
|---|---|---|---|
| 1A：验证适配前提 | DSH来源、模型持久化政策与音画服务探针；固定配置Schema和特性清单 | 独立探针脚本、虚构样本、结果文档；不接真实平台 | 关键路径有实际证据，未支持项明确；不伪造通过 |
| 1B：契约与受控生命周期 | v3类型／Schema、注册表、准入屏障、managed生命周期 | contracts、core注册、memory／QQ生命周期适配、测试夹具 | legacy回归与屏障故障用例通过 |
| 1C：迁移与存储 | runtime v1、journal v2、memory v7和只读预检／迁移工具 | core执行存储、journal／memory迁移、manifest、旧schema样本 | 重复与中断迁移通过，无权限扩张或历史变化 |
| 1D：Task／Run执行 | TaskRepository适配、执行授权、DSH frame、原生来源、事件与聊天投影；预留动机／异议衔接 | core执行协调器／runtime、timeline来源适配 | 收尾无消息任务及旧聊天恢复；当前仍为中途检查点 |
| 1E：底色、阶段人格与连续性 | 分1E-1底色／增量迁移、1E-2显式候选和阶段投影、1E-3观察／TaskIntent／压缩接续 | memory v8、runtime v2、GrowthProvider／PersonaGrowthPort／ContinuityPort、来源策略 | 显式更新、任务边界、删除、隔离、压缩与重启通过；自动归纳仍属记忆E |
| 1F：Host入口 | 配置、装配、健康、独占start／run、排空与新schema／清单诊断 | packages/host、入口脚本、新底色模板 | 一个入口可重复启动和关闭，状态不被模板覆盖，依赖故障明确 |
| 1G：联合验收与版本 | 新底色与阶段人格的真实模型／任务／连续性对照、全部回归、迁移和资源 | 第一阶段验收报告、发布清单和Git标签 | 所有本阶段必需项有证据，未完成项与后续长期成长分开 |

Host生命周期夹具在1B开始提供，正式CLI在1F装配；不等到1F才验证依赖。1C新存储可先用原生测试驱动检验，1D再接入DSH。为保持可构建，可在功能分支使用显式未启用特性，但不能对外暴露未完成接口。

文件级落点：

- contracts在已有execution／lifecycle基础上增加growth、persona、continuity、task-intent及execution-source契约；现有index/context/history/compaction/task-workspace保持旧导出并增加明确适配。
- core新增execution-coordinator、runtime-store、execution-authority及managed生命周期；现有index/runtime/context-runtime/feedback-runtime/compaction-runtime/source-records按同一Frame改造。
- journal新增迁移及ExecutionEvent读取；旧会话查询的范围谓词保持。
- memory保留已实现v7及task-repository-adapter；新增v8迁移、execution-memory、growth-provider／persona状态仓储、continuity与task-intent适配；runtime另增v2清单旁表及迁移。同步更新预检／全部旧迁移识别，不能只改顶层版本。
- timeline增加任务来源解析和授权分支；普通工具的查询参数不能选择task范围。
- host新增独立包及TypeScript项目引用；package-lock和workspaces只在真正实现时更新。
- 测试新增host-lifecycle、execution、execution-recovery、protocol-compatibility、growth、runtime-migration等有实际行为断言的套件；保留全部既有功能回归。

## 15. Git、发布与设计决定

本方案先以文档提交入库。功能实施使用建议分支`phase-1-core-host`，子步骤采用可构建、可验证的提交。契约、迁移、运行和验收分别可审阅；不把运行数据、凭据、私人记忆、媒体探针缓存或备份提交Git。

提交前运行`npm test`和差异检查，真实验证单独报告；测试失败先查证，不能通过放宽超时／权限断言伪造通过。因环境或测试时序出现的失败与复测均记录。完成后按实际包变更提升版本，合并main并建立明确的阶段标签；本次方案不提升功能版本或schema。

不创建远端、不推送。工作区已有无关修改原样保留，只暂存本阶段文档／源码清单。服务器部署、现有账号接管及数据库实际迁移不由本方案提交自动触发。

| 决策 | 本阶段定案 |
|---|---|
| P1-D01 | 新Host强制managed，旧入口默认legacy；准入屏障覆盖注册、恢复和后台分析 |
| P1-D02 | v2入口与常量保留，v3单独注册并共用注册表；不以一次改API_VERSION破坏旧插件 |
| P1-D03 | 普通聊天taskId允许为空，内部任务必须有Task；native来源区别于maintenance |
| P1-D04 | Task仍由原memory仓储持久化，runtime只管理Run；新Run不伪造旧Conversation工作票据 |
| P1-D05 | 成长状态扩展为有来源的显式候选、阶段版本与场景选择；自动全局归纳仍留记忆E |
| P1-D06 | 只升级实际需要的journal／memory并新增runtime；其它库本阶段保持格式 |
| P1-D07 | 普通聊天与内部任务共享DSH运行适配，内部任务没有自动渠道发送路径 |
| P1-D08 | 图像和实际音轨探针是未来B站音画能力的前置核验，不把探针当完整媒体实现 |
| P1-D09 | 稳定底色与阶段人格／临时状态分开；爱世界允许情境中的回避和反击，仍遵守能力范围 |
| P1-D10 | 兴趣判断自主、明确任务负责；任务动机、异议与人格更新分开记录 |
| P1-D11 | 1E采用memory v8/runtime v2增量，保留1C及旧Run含义；连续性不靠思考归档或虚构缺口 |

任何实现偏离这些决定，先更新本方案说明原因、数据影响和验收变更，再修改代码；不在实现中静默降低目标。

初版曾将总方案升为文档1.1；本次将第一阶段方案升为1.1、总方案升为1.2，增加人格成长与连续性要求。项目功能版本仍为0.19.0；运行schema不因本次文档提交改变。

## 16. 初版方案文档核验记录

- 已结合核心、Host旧入口、注册／恢复、DSH类型、记忆来源／迁移和测试夹具核对设计；未实施上文任何功能。
- 首次全量基线运行有1项失败：`changing a sibling working item preserves the original item version and its admitted history`，期望delivered、实际failed，耗时约6.62秒。该夹具使用5秒回合超时，存在时序压力嫌疑，但本轮未取得足以确定根因的进一步诊断，不宣称已修复。
- 保持源码和测试不变，该用例单独复测1/1通过，耗时约0.54秒；随后再次运行`npm test`，421项全部通过，0失败、0跳过。保留首轮失败事实，不以最终结果改写首次结果。
- 本次仅新增方案并更新入口／总方案接口细化，现有项目版本、协议常量、运行配置和数据库均未改变。
- 本次3份文档的87个本地链接、Markdown围栏、16节编号和44项验收／4项探针的唯一编号检查通过；本次变更范围的Git差异检查通过。
- 全工作区差异检查仍报告原有`docs/memory-phase-1.md`第22行尾部空格；该未提交修改的文件哈希与开工前一致，原样保留且不纳入本次提交。

相关材料：[总方案](unified-runtime-wakeup-plugin-plan.md)、[原架构](architecture.md)、[开发约定](development.md)、[任务工作区](agent-memory-phase-c.md)、[任务授权检索](agent-memory-phase-d1.md)、[上下文装配](memory-phase-4.md)、[D3模拟交付](agent-memory-phase-d3.md)。

## 17. 人格方案修订记录

2026-10-24：依据用户认可的独立判断／任务边界，以及爱世界、阶段人格、记忆污染和压缩连续性的讨论修订。新状态、接口、数据与验收依据[人格成长与连续性方案](persona-growth-continuity-plan.md)；本轮仅文档核验见[记录](persona-growth-continuity-review.md)。1A—1C及1D检查点的历史结果不改写，新要求没有被记作已实现。
