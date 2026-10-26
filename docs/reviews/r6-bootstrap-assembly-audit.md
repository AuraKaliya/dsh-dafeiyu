# R6 bootstrap 装配与资源所有权审计

2026-10-26。依据`docs/server-execution-r6-plan.md`、项目公开入口与本机Cordis 4.0.5／DSH 0.2.1-rc.2接口作AI源码审计。此代理没有连接服务器、调用模型或执行构建／测试；线上ABI仍须另核。下文保留此前的内嵌装配评估与Host provided-DSH实验记录，**它们已不作为生产主路径**。

## 最新结论：保留基础组件，采用独立ManagedHost进程

主代理已根据另一代理的实际基础组件检查收敛为“ManagedHost独立进程＋固定executor枚举”。父官方compaction-basic捕获this并处理全局agent/pre-step与request-error，单独service isolation不能屏蔽该writer；父typert还会拒绝重复agent lookup/context注册。不能为内嵌新产品去修改或禁用这些DSH基础组件，因此此前独立子Registry／Loop／Prompt的方案仍不足，内嵌路径不进入生产。

主代理报告Host provided实验8项中7通过；未知schema用例确已拒绝启动，失败来自只读SQLite检查建立SHM/WAL使整树字节对比变化，不是未知schema被放行。该未提交wrapper与实验源码由主代理安排撤回，此代理不再修该分支。下面标为“本轮已写”的内容仅记录实验，不表示保留在生产或已提交；独立ManagedHost路径不需要它。第二轮基础依赖探针仍用于核对应保留的官方基础功能、额外插件与所需服务，不能据此扩大清除范围。

## 此前内嵌候选装配路径（已排除生产）

保留父DSH的官方基础插件和服务。bootstrap使用受信固定配置，不启动ManagedHost，也不另建完整Context。现有产品Core／Memory／渠道能力都经公开apply或Service类装配，模型循环继续使用官方DSH实现。

1. 校验实际借用服务与配置：至少sessions、sessionPersistence、sessionQuery、tools、llm；检验包ABI、模型路由、JSONL配置与当前provider身份。解析现有Host配置、核对底色和路径，先做项目存储只读预检。缺失依赖须明确失败，不能让`await ctx.plugin()`一直停留在PENDING。
2. 仅claim项目core／memory／channel目录；claim后再核对路径、config hash及预检，排除竞争变更。新库只能通过显式初始化入口创建；普通启动仍`createStore:false`，现有数据和迁移凭证不重置。
3. 在同一产品子作用域隔离`agents`、`agentLoop`、`systemPrompt`、`attachments`、`compaction`，装配官方AgentRegistry、Prompt、AgentLoop（agents=[]）的独立实例；父基础实例保留。该最小scope替代由另一代理的`server-dsh-scope.test.ts`验证，本文不提前宣称测试通过。
4. 子scope内依次装Core(managed)→Timeline→Memory(managed)，再执行一次`Core.configureExecution({profileId,policies,createStore:false,...})`。Memory构造会绑定repository、persona、execution memory、native expression，不能在legacy模式下省略这一步。
5. 注册固定executor；装Activity、Media、Bili、QQ(managed)。Media先于Bili／QQ media；Activity启用maintenance时绑定`memory.maintenance.schedulingPort()`。QQ立即holdIngress；验证policy列出的实际动作都已注册。
6. Memory.recover→activate，使真实来源及persona provider就绪；executor仅恢复事实／受控收尾，不补跑模型。Activity.recover→activate、Media.recover→activate、Bili.recover→activate；随后await Core.recoverExecutions→Core.recover。需要媒体回执修复时复用reconcileMedia，但它有账本写入，必须位于已持有项目资源的恢复阶段。
7. Core.activate({deferWork:true})后QQ.start并有界等待online；必需渠道不在线则关闭本候选。最后Core.activate释放准入→QQ.releaseIngress→Activity.start。Memory的onReady分析启动也因此发生在最终准入阶段。
8. bootstrap维护自己的ready/degraded/draining状态与executor在途数，借用服务替换即撤销就绪并排空。不要拿旧Host硬编码能力标签或旧运行目录健康文件作为新装配成功证据。

## 已确认的装配阻断

**仅在caller context隔离attachments／compaction不足。** 另一代理沿`dsh-agent-loop/lib/index.js`确认：AgentLoop.prepare采用`this.runtime.ctx`，ReactLoopAgent的createScope来自固定loopCtx；调用者ownerCtx主要承担生命周期归属。因此父AgentLoop不会自动继承bootstrap caller的新隔离标签。必须在子scope装配官方Registry／Loop，再核对真实create与resume所得agent.ctx。
子AgentLoop还会注册provider/model prompt变量；共享父Prompt会触发NamedEntries重名。最小替代还需隔离systemPrompt并装官方Prompt；不删除父Prompt。该静态发现及替代均由专项scope测试进一步验证。共享SessionProjections同版本引用计数的可行性也以该测试为准。

**冲突检查贯穿实际执行。** `core/index.ts`注册Memory compactionProvider时检查父compaction，`core/compaction-runtime.ts`在真实压缩入口再次拒绝冲突writer。`media/service.ts`与`media/images.ts`均拒绝已有attachments。必须保证产品agent及媒体传输实际使用同一子scope，不能只屏蔽构造检查；不能通过卸载DSH官方基础组件解决。父全局监听器不会因一个service标签隔离自动消失；本机没有完整服务器dsh-base／compaction-basic装配，线上具体hook仍待ABI与运行检查，不能泛称全部已隔离。

**Timeline还要求sessionQuery。** `packages/timeline/src/index.ts`公开inject为dafeiyu/sessionQuery/agents；Core的inject列表并不包含它。bootstrap的父服务要求必须包含query，否则Core可创建但Timeline／Memory无法完整装配。

**Bili媒体接线是构造时绑定。** BiliService在构造时检查media.assets.v1并注册BiliMedia provider；先Bili后Media不会自动补上该绑定。QQ的capabilities/tasks/media同样在构造时注册；configureExecution及Memory相关端口须已存在。QQ.start还要求Core lifecycle已active，所以holdIngress与deferWork两个阶段必须保留。

## 父持久化路径的公开核验

SessionPersistence公开API有稳定`identity`、create/open/stat/list/flush，没有root。JSONL的projectDir/sessionDir虽在本机bundle内部存在，却未从public入口导出；安装包也没有可用src实现，不能深导入私有路径或用any读取root冒充公开接口。
根代理采纳的最小路径是公开`ctx.registry.get(Persistence).fibers`：仅选择唯一ACTIVE实例，把public fiber.config先视为unknown并通过只含root/compression等字段的schema验证，再比较fiber.ctx.sessionPersistence.identity与当前借用身份。核对实际解析路径与配置一致，持有identity用于服务替换检测；无法识别、多个匹配或身份变化均fail closed，不扫描全部会话补猜。Query使用其公开config／launcher路径契约核对，由根代理`provided-services.ts`及专项测试承担。
无模型canary的create→handle.flush→stat可以证明服务持久化，但不能仅凭stat证明指定磁盘root；还涉及私有目录布局、默认zstd编码和残留空session。既然已有公开registry配置途径，本阶段不新增这种启动写入，也不假定session.v4.jsonl路径。

## 共享存储与现有Host helper的边界

现有`loadHostConfig`可以复用配置、插件schema、依赖顺序、路径去别名及底色检查，无需复制一整份配置解析器。但它定义的resources含core、memory、sessions、query、channels；其完整列表也用于manifest.paths绑定。**实际路径绑定不等于资源独占。**

- 旧inspectHost会检查query的Host schema、model-deepseek credentialStore存在性，以及全部resources的占用；initializeProfile要求全部资源为空；readHostStatus要求lease与config.resources逐项等长。因此它们不能直接配合过滤后的claim，也不能将shared query“版本不符”简单当未知错误忽略。
- provided模式的专用入口只拥有core/memory/channels；sessions/query是借用服务，不claim、不初始化、不迁移，也不整根检查或备份。父模型／凭据服务不重新安装；credentialStore存在与实际路由由明确父provider绑定取证。
- manifest仍绑定完整实际路径，readManifest及旧manifest字节不变。不能修改prepared.resources后再用readManifest，制造路径列表兼容；借用关系由bootstrap自己的绑定／状态明确表达。
- 共享sessions中的本项目备份应由本项目journal/runtime/delivery/analysis持有的session ID引用清单驱动，逐ID使用公开stat／read handle；不以agent名字前缀或整根list作为归属证明。共享query是父服务派生索引，不属于本项目权威备份。
- 旧readHostStatus不适用于provided模式的资源子集；bootstrap使用独立状态文件。provided配置不得误交给旧ManagedHost.start；该入口仍自建DSH服务并要求import前DSH_HOME等于core/dsh-home。bootstrap保留父进程DSH_HOME，不重设环境冒充独立Host。

## 本轮Host小步实验（不进入生产）

仅修改`packages/host/src/profile.ts`，新增公开命名函数，现有index的`export * from './profile.js'`已使其可从`@dafeiyu/host`使用：

| 函数 | 行为 |
| --- | --- |
| providedDshExclusiveResources | 从已解析资源中选出core／memory／channels目录；不返回sessions/query |
| inspectProvidedDshProfile | 沿原预检检查项目schema／身份／包版本／媒体依赖／迁移／占用，明确排除借用query的Host schema与Host credentialStore文件存在要求；ready只证明项目预检，不证明父provider已绑定 |
| initializeProvidedDshProfile | 仅在项目拥有资源全空时claim并初始化所有所需项目store；不创建或改变借用sessions/query；manifest继续保存完整实际路径 |

旧inspectHost／initializeProfile经共享内部实现维持原standalone规则，未修改旧readHostStatus、配置schema、manifest schema、迁移函数或父服务接口。claim自身会写协调库，不是纯预检；任何首次初始化仍是显式可写操作，不能在普通启动中自动补做。

实验新增`tests/host-provided-profile.test.ts`共8项；主代理后续结果见页首。用例包括：只读预检不改共享内容；保留父共享资源claim并初始化全部项目store；同core真实占用冲突；未知项目schema拒绝；旧standalone拒绝非空共享目录；旧manifest字节不变；父模型绑定只豁免Host凭据文件存在要求；缺失共享目录也不被创建。仅用D盘受管虚构夹具，无模型／平台／凭据读取。

## 可复用helper与退出次序

| 现有helper | 可复用方式与限制 |
| --- | --- |
| pluginConfig、dependencyOrder、各公开ConfigSchema | 复用解析与依赖判断；不导入任意插件factory |
| loadHostConfig、assertPaths、readManifest、layoutPaths、packageVersion、inspectStorage | 读取／验证helper；有文件系统读取，不能笼统叫纯函数。inspectStorage用于拥有的项目store，不检查共享query以证明本项目所有权 |
| physicalPath、pathIdentity、resource、within、overlap | 现有paths模块可复用路径去别名／重叠判断；当前根入口仅导出HostResource类型，如bootstrap外部要用可显式新增命名导出，无需重写逻辑 |
| claim／lease.release | 原子项目资源占用；只释放本实例instanceId＋pid匹配的记录，release要等拥有资源确实关闭 |
| reconcileMedia | 恢复阶段可直接复用；不是纯函数，可能改变media结算。当前未由根入口导出，可按需命名导出 |
| bindMigratedProfile／initializeProfile | 有权威记录写入；只有明确迁移／初始化路径调用。不能当预检helper或用来补造已有服务器数据的初始化历史 |

关闭先停Activity新唤醒、executor新派发、Core准入和QQ入站；Memory用stopBackground而非过早quiesce，以免在途Run的真实来源guard被提前撤销。等待Core／Memory／QQ／Activity／Media／Bili／executor自有工作；超时走各自取消与保守unknown收尾。
排空后关闭QQ、Activity、executor、Bili、Media、Memory，卸载Timeline，最后Core及子AgentLoop／Registry／Prompt，释放项目lease。Bili先解绑Media，Memory在Core端口仍存在时flush并解绑。保存真实回执，不将取消写成无副作用。
拥有的child fibers与句柄逐一记录，失败也执行相同幂等收尾。Cordis效果按注册逆序释放；统一drain步骤必须在自动child清理前执行，不能假定整个父root dispose有依赖顺序。不要复制ManagedHost的`this.ctx.fiber.dispose()`来销毁父DSH，不关闭父sessionPersistence/sessionQuery/llm/tools，也不调用其全局flush替代本项目handle flush。独立SYSTEM update-guard／maintenance始终不归bootstrap释放。

本文不宣称内嵌方案可上线，provided小步不进入生产。独立ManagedHost主路径的后续开发和测试另记；真实部署前仍须以线上实际版本、服务来源和依赖闭包核验，未确认的问题保持明确未验证状态。
