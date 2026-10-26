# R6：受信生产启动与父子共享预算接线

2026-10-26。依据当前 Host、server-executor、server-bootstrap、7C billing/ledger 源码编制，接续已提交的 [R6f 细案](../server-runtime-r6f-plan.md)。本文是实施设计；没有创建运营授权、移动账本、调用模型或操作服务器。

## 1. 现状与最小边界

| 现有入口 | 已具备／仍缺少 |
|---|---|
| `packages/host/bin/dafeiyu-host.mjs` | 先绑定本进程 DSH_HOME 再导入 Host；不更改桌面环境。 |
| `host/src/cli.ts` | inspect/init/status/migrate 有独立分支；常规 start/run 只传 onModelCall 计数，没有可信生产预算／Windows port 工厂。 |
| `host/src/runtime.ts` | 已接受 serverExecutorDependencies；新 awaited installModelAdmission 钩子在模型服务就绪后、Core/Memory 构建前调用。onModelCall 不具备预留、usage 或结算权威。 |
| `memory/src/analysis-runtime.ts:26` | 隔离 AnalysisRuntime 的 SharedTransport 最终调用父 `host.llm.stream`；父钩子可覆盖它，不能再在内外各记一笔。 |
| `server-executor/src/service.ts:121` | 先持久准备真实 job，再把 job.id 固定到局部 budgetPort；child 不能自选 job、scope 或预算授权。 |
| `evaluation/executor-budget.ts` | 一个实例固定一个 jobId，并借用已打开的 EvaluationLedger；当前需要多 job 路由层，不能启动前猜一个 jobId供所有任务复用。 |
| `evaluation/real-runtime.ts:66` | 当前 7C 直接组装 DSH，已在 Core/Memory 前安装 evaluation billing，并用 DeadlineAdapter、固定 normal maxRetries=0；它不是生产 ManagedHost CLI。 |

新增独立 `@dafeiyu/server-runtime`。依赖方向为 server-runtime → Host / Executor；server-bootstrap 继续只拥有 standing-authority 等独立契约，不能形成 Executor → Bootstrap → Host → Executor 环。

第一子步只实现可复用共享 call gate、父模型钩子、child 多 job router及受信资源工厂。它借用明确提供的资金权威，不建设新的通用收费系统，不声称完整生产 CLI 或运营授权已经就绪。

## 2. 两种资金域必须分开

### 7C 当前验收

唯一权威仍是本机 `.runtime/acceptance/7c-20261026/evaluation.sqlite`，以及其冻结 config、追加授权、证据、原 lease/attempt/clock。工厂不得调用 create/open-new-ledger、begin、startExecution、stopExecution 或追加授权；这些仍由现有 `real-execution.ts` 的单协调者负责。

原 config 60 元保留；此前“停点后剩余 50 元”授权以追加修订形成累计有效上限 97.894922 元。**50 元不是当前可重新领用的余额**，即时剩余、已按上界计入的未知费用和停止状态一律读取原账本。原累计运行 6 小时、首次真实调用后 48 小时不增加、不重置。

父、child、摘要、记忆分析和其它辅助调用必须归入同一合法 attempt 与当前阶段。单时钟覆盖协调者的实际运行区间，只记一次墙钟时间，不把父子重叠时间重复相加，也不把调用耗时之和替代既有累计规则。所有截止时间取原授权／剩余累计时长／当前 case／Run／standing authority／单请求超时的最小值。

现有校准仍走 openRealEvaluationRuntime；不能再叠加第二个 billing listener重复收费。接入新的 ManagedHost 校准入口时使用同一账本适配器和真实场景授权，不能凭空添加 case、重开 attempt、伪造主人入站或把旧校准证书改成新入口已通过。任何新增场景按冻结协议和既有验收流程处理。

### 未来服务器运营

运营授权需另行明确来源、授权 ID、金额、有效期、路由／价格 hash、scope、未知费用和停止行为。当前没有新运营额度可默认启用；无有效资金端口时禁止付费派发。不能把 7C 的余量复制到服务器、把旧账本换路径清零，或用本地假账本给生产提供“余额”。

本子步不实现运营账本，也不把 EvaluationLedger 的 case/人工评阅字段伪装成运营任务。后续若获授权，可增加一个最小持久运营授权窗口实现，复用整数 micro-CNY、保守上界、幂等结算、未知占用和单所有者规则，并通过同一程序端口接入。它必须独立标为运营、显式初始化，不能影响 7C。

若需要服务器上的付费验收仍消耗本机 7C 余额，须另做由原协调者拥有的受信远程预算通道；现有本机 Node IPC 不等于跨主机预算通道。未完成该通道前只做服务器离线装配／权限检查，不能搬账本或让服务器自己开一个验收余额。

## 3. 最小程序接口与固定启动

Host 钩子沿根代理已实现签名，不再扩展 JSON 动态加载能力：

```ts
installModelAdmission?: (ctx: Context, config: PreparedHostConfig)
  => void | Promise<void>;
```

server-runtime 工厂从受信代码获得一个已有预算 backend，以及与 Host 身份、route、授权 ID匹配的固定参数。backend 分清 host-model 与 executor-job；父调用不伪装成一个 executor job。父钩子和 child ExecutionBudgetPort 共用一个 gate与权威。生产 JSON只包含文件路径、hash、SID、版本和授权引用，不能提供函数、替换 runner、任意模块或测试 clock。

启动顺序：

1. 薄入口只用文件／路径逻辑验证固定参数，设置当前进程 DSH_HOME，再动态导入生产装配代码。
2. 校验 Host 配置／正式底色／迁移完成、manifest、凭据绑定和已授权资金来源；资金不足或未知时不启动业务。
3. 仅 start/run 创建真实 WindowsProcessControl并预热固定 proof helper；验证实际父进程 SID、管理员 token、Node/PowerShell/probe hash，不凭 danger-full-access 字符串声称管理员。
4. 构造共享预算 runtime，将它的父 installer与 child port注入 ManagedHost.start。installer必须被 await，在 Core/Memory/渠道激活前完成；失败走资源释放，不能继续 ready。
5. Host/Executor使用同一份授权 ID；自主 standing authority也须匹配。child真实 job、nonce、profile、权限证明握手完成前不交付业务 stdin。
6. 启动工厂持有资金 runtime和Windows port；Host只借用端口。成功／启动失败均有唯一关闭所有者，不能重复关闭或提前关闭 child仍依赖的 proof helper。

inspect/status只读；init保留原本显式创建空存储的职责，不能说它零文件写入。它们均不得因本接线启动模型、网络、Windows helper、业务 child或平台消费者，也不得解析密钥值。配置加载和模块 import不预热 OS port；初始化 budget授权更不能藏在普通 init/start里。

## 4. 共享准入、观察和取消

同一权威初版只允许一笔实际模型派发在途。FIFO只锁 **reserve → stream → settle**，不锁整个 Run、task、case或executor job。父模型结束工具调用回合并完成结算后，child才能取得下一许可；如果父任务持有整场锁等待 child，会产生死锁，应由测试阻止。

- 等待者尚不预留费用；在途占用导致的暂时不足排队，不能误报永久预算耗尽。取消／期限到达时从队列退出，未派发者不产生费用记录。
- 每次取得许可前重验 signal、期限、授权／route／请求上界、凭据与配置 hash。禁止嵌套派发在持有本调用许可时等待自己；检测后明确失败，不能无限挂起。
- 父 hook按既有 billing语义生成独立 callId、requestHash、sessionHash、purpose与上下界；复用子协议的 usage校验。cache读／写与uncached输入分开观测，reasoning已计入output，不重复加算。只保存元数据，不保存 prompt、thinking或原始错误。
- child模型与辅助会话经过原 IPC；Tool permit仍验证活 Core grant，不能把模型资金许可当作外部写授权。
- 缺 usage、异常计数、error/aborted/interrupted、超上界或结算不明确均保留未知，不退款、不写零。任何未知立即关闭**父和所有child**的新准入；已经开始的 settle仍必须完成，不能因 task权限撤销或预算signal abort拒绝记账。
- 超时不能只停止消费输出后声称 HTTP取消。复用 real-runtime 的 deadline/cancellation原则：父模型须能取消真实请求及 Core/Memory当前工作；包括隔离分析、compaction和独立校验。child通过原deadline、活grant和IPC取消。无法确认结束时保留未知并阻止新任务，原时钟继续如实收尾。

专用文本CLI已拒绝结构化媒体并固定 normal零次重试；父 Host不能借此宣称视觉费用已覆盖。Files内部再派发的7D门槛见 [重试审查](r6-deepseek-retry-metering-audit.md)。

## 5. 动态 job 与恢复

不在启动时生成占位 jobId。Service先 prepare真实job，再经其已有局部guard调用共享 child router；router只接受该受信程序调用链，按首次reserve的jobId建立一个固定适配器。7C适配器同时捕获当时的parent attemptId，后续settle使用已记录的绑定，不回查一个可能已切换的“当前case”。

同一callId不得跨job、route、requestHash或authorization复用；不同job不能互换reservation。多个job可依次使用同一runtime，费用总账和gate不分叉。现有evaluationExecutorBudget的一job实例可作为router叶子复用，其回执缓存不能在进程重启后当持久账本使用。

父总账保存call/reservation及所属attempt；executor.sqlite的budget_links保存实际job关联和settlement hash。父预留后link写失败，按现有Service规则保留／转未知；结算提交后ACK丢失，保持歧义，不能拿另一usage覆盖旧行。需要补齐的绑定持久证据按既有追加记录或明确小迁移完成，不仅放内存Map。

恢复只核对原账本、executor jobs/budget_links、封存回执与实际进程事实。遗留reserved未知、启动窗口不明、断链后无结果均阻止新准入；不重发模型，不更换requestId重放job，不自动account-at-maximum或新建授权。原9笔实际费用未知及其既有处置保持；新未知必须按实际授权规则另行处理。

## 6. 关闭顺序与当前限制

先关新准入／停止新消息和自主唤醒，再等待父模型、Memory分析、executor及所有结算。正常排空完成后封存结果和费用回执；超时则取消真实工作，逐项记未知。其后关闭Host服务／ctx、证明所有费用回调已结束，再关闭本实例的Windows proof helper与共享准入资源。借用的预算backend、外层lease／时钟仍由原所有者关闭；7C stopExecution只由原协调者调用，工厂不代办。

WindowsProcessControl当前只证明父／child身份和即时token；终止使用原ChildProcess句柄并保留创建身份检查。它明确没有完整进程树约束，terminate返回verified=false，不能由启动器改成true。root exit、SDK工具completed和模型final都不是全部业务效果或无脱离子进程的证明。

## 7. 第一子步验收与后续授权

新增相关受管测试必须覆盖：首次Core/Memory激活前已安装、安装失败释放；实际父DSH、隔离AnalysisRuntime、真实background/compaction与child同账本；多job精确绑定；父工具回合释放后child取得许可；队列取消／到期／暂时占用；未知关所有新准入但在途settle不丢；重复／冲突settlement；proof factory失败和正确关闭顺序；inspect/init不调用任何runtime工厂。

联测使用D盘虚构账本／脚本模型及明确的OS替身标签。接原7C时只借已有ledger／attempt／clock，不另建一笔“测试授权”。实际服务器token、渠道、费用与最终交付仍各有独立真实验收门槛。

有限初始运营窗口可以作为后续具体配置提案：明确一笔单次金额、绝对截止时间、允许的渠道／维护场景、未知即停、无自动续期，完成后由用户决定是否续用。本文不填默认金额、不预先视为已授权；这些字段未确定时，只能交付可检查的代码和离线证明，不能开放付费运营。
