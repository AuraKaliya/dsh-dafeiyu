# R6f：生产薄 CLI 与显式运营资金窗口

2026-10-26。接续 `0957f90` 的共享模型准入、生产资源工厂及定向检查。本文件只规定下一子步；当前没有新增运营资金授权，没有填写真实金额、建立真实资金库、调用模型或连接服务器。

## 1. 已有基础与本步边界

现有 `@dafeiyu/server-runtime` 已提供 `SharedModelBudget`、父 `llm/stream` 挂载、动态 executor job 路由和 `createProductionRuntime`。父模型、Memory background、独立分析与 compaction 使用同一资金入口；未知停止新准入，已派发结算继续。每个 Cordis app root 只允许挂载一次全局资金入口，不承诺同一 app root 内任意隔离 LLM 的独立计费。

当前普通 Host CLI 尚未构造生产端口。本步新增固定薄 CLI 和一个单币种、单路由、单资金窗口的持久 adapter。复用现有整数费用、FIFO、严格 usage、IPC、Windows proof 与 Host 生命周期；不增加通用账户、汇率、支付、退款、自动续费或新模型循环。

7C 唯一账本仍为 `.runtime/acceptance/7c-20261026/evaluation.sqlite`。原累计有效上限、旧费用与未知记录、6 小时累计时间、首次调用后 48 小时均不变；本文不把“此前授权后剩余 50 元”重新当成可领取余额。运营库不能读取余额后复制成另一份授权，也不能伪造 CAL/case/attempt 来使用验收额度。

## 2. 固定命令面

新增 `packages/server-runtime/bin/dafeiyu-server.mjs`，只动态导入本包固定模块。命令严格拒绝未知参数、重复参数、缺值、位置歧义和多余参数。

| 命令 | 允许的动作 | 明确不做 |
| --- | --- | --- |
| `inspect --manifest <file>` | 只读检查固定 manifest、Host 配置、资金/价格元数据、路径与文件 hash，报告阻断项 | 不开模型、平台、proof helper、业务 child；不新建 SQLite、目录、lease 或授权 |
| `status --manifest <file>` | 只读 Host 状态与资金汇总、原 lease/未知计数；区分实时数据和旧快照 | 不检查余额的网络账户，不自动回收 lease，不变更状态 |
| `operator-init --manifest <file> --authorization <file>` | 对一个明确批准、从未初始化的 fundingID，首次建立专用资金库和初始化凭证 | 不调用 Host init，不补建丢失旧库，不覆盖任何原授权/账目，不启动 proof 或模型 |
| `operator-amend --manifest <file> --authorization <file>` | 在窗口仍有效、无活动 lease、无在途调用时追加明确的增额授权记录 | 不自动读取新文件生效，不改旧行，不延长原截止时间，不消除 unknown |
| `start --manifest <file>` | 固定生产工厂启动 daemon Host，显式接入同一运营 authority | 不临时选择其他 provider、预算文件或代码模块 |
| `run --manifest <file> --request <file>` | 同一生产工厂，以 single-run 执行一个已解析的业务请求 | request 不能携带资金、凭据、OS port、adapter、runner 或模块路径 |

Host 现有 `init/migrate` 继续由原入口执行，沿用空库初始化/显式迁移规则；它们不隐式创建运营资金。新 CLI 不重新实现 Host 初始化/迁移，也不通过调用旧 `runHostCommand(start/run)` 丢失生产端口。

所有路径来自固定 manifest 与命令的明确输入。薄入口只读公开配置以确定物理 core 路径，先设置本进程 `DSH_HOME=<core>/dsh-home`，随后才 import Host。不得加载 `.env`、改变桌面 profile/全局环境或动态载入 JSON 指定的函数、脚本、任意 npm 插件。

## 3. 三份数据及固定绑定

### Launch manifest v1

必须显式包含：schemaVersion、profileId、agentId、Host 配置绝对路径和 prepared config hash、固定资金库路径、fundingID、初始授权 hash、价格文件路径/hash、模型 route、maximumCallMs、drainTimeoutMs、Windows proof 配置及允许的 SDK/launcher/profile 文件 pins。没有金额、期限或路径的隐式默认值。

沿用现有 Windows 配置：Node 路径/hash、固定 PowerShell 路径/hash、固定 probe hash、expectedOwnerSid、受管临时目录。Node pin 必须与 executor command 相同；child profile、entry、args、DSH_HOME、credential binding、tools 白名单仍由现有 manifest reader 独立验证。

固定 SDK pins 至少闭合本机实际使用的 DSH/LLM/provider/credentials/profile-boot/headless public entry 与 package identity；按已验证依赖清单精确校验，不在启动时递归扫全盘或自动接受新版本。目录联接、相对穿越、UNC、非预期盘/根、hardlink、父目录替换按现有真实路径验证规则拒绝。

Host chat route、父模型默认输出/有效 effort/contextWindow、executor route、资金 route、价格 route 必须一致。继续 await `validateParentModelAdmission` 后才创建 Core/Memory/渠道；256000 等超出窗口预算上界的 provider 默认值必须在启动时失败，不能修改冻结请求掩盖不匹配。

### Funding authorization v1

建议字段：fundingID、profileId/agentId、Host binding hash、currency=`CNY`、maximumMicroCny、notBefore、expiresAt、priceHash、routeHash、批准来源引用及其 hash、批准时间、授权用途、明确的未知停止规则。

金额是显式正整数 micro-CNY，期限是绝对 UTC 时间；当前文档不给任何真实数值。批准来源须来自实际用户/操作员授权材料。仅填写 `approvedBy: human`、复制测试文件或模型自述不构成人类授权；可信 operator-init 是消费已有授权的操作，不是自动申请/生成授权。

生产接受的用途仅为明确运营窗口。合成/本机验证用途有独立标记，生产 CLI 拒绝；不能通过将测试余额设得很大或不断重新初始化来获得运行资金。授权文件只有元数据，无 API key、账号登录态或会话正文。

### Price file v1

固定 CNY micro-unit/token 比率、provider/model、输入 uncached/cache-read/cache-write 各桶费率、output 费率、价格来源/生效版本，以及唯一的舍入算法标识。不在启动时联网查询价格或自动切换价格；price hash 变动即拒绝该窗口。

预留采用输入三个桶中最高单价和请求完整 context/output 上界。整数运算用 BigInt 中间值计算，最后只接受安全整数；金额不经浮点元计算。建议费用算法固定为 `ceil((Σ tokens_i × price_i) / 1_000_000)`，预留同算法用 contextWindow × maxInputPrice + outputBound × outputPrice，因此分桶舍入不会额外突破上界。reasoning 已包含于 output，不再加算一次。

usage 对应冻结价格的计费记录不是供应商账户余额查询。价格缺失、费率/单位不明或某类调用不可计量时禁止派发，不默认免费。

## 4. 一次初始化与缺失保护

`OperationsFundingStore.openExisting` 永不 create、mkdir、DDL 或迁移；文件缺失/为空/错误 schema/错误 application_id、身份或完整性不匹配均失败。readonly inspect/status 也不能因 SQLite 的默认 open 行为生成空库。

只有 operator-init 走创建路径：

1. 先解析并核验授权、manifest、价格和目标父目录；要求专用新窗口目录、目标库以及 fundingID 初始化凭证均从未存在。已存在的目录即使空，也不作为“丢库后可重试的新窗口”。
2. 在固定 operator receipts 根目录以 exclusive create 认领 fundingID，写入 `initializing` 凭证（授权 hash、目标物理路径、manifest/price hash），fsync 后再创建库。凭证保留在数据库目录之外，纳入部署备份。
3. 以 exclusive 文件创建及数据库单事务写 schema、不可变初始授权和初始化事件，提交后写明确的完成凭证；两个步骤间崩溃保留 initializing，不能自动重试初始化。
4. 已完成凭证存在但 DB 丢失、DB 存在但凭证丢失、两者内容冲突、同 fundingID 换路径，全部报错；正常 start/Host init/operator-init 都不能修复或生成新金额。恢复必须依据原备份/凭证另做显式审计步骤。

凭证目录本身也固定绑定并检查现存 identity，不因缺失而偷偷重建。首次部署建立该空 receipts 根属于明确的运维准备；不能在普通 start 中办理。完全删除整套库、凭证与部署材料后的历史无法凭空恢复，本步不提供“强制重新开始”开关。

## 5. 最小数据库与单所有者

可用一个独立 `operations-budget.sqlite`，不改 EvaluationLedger schema，不复制 executor.sqlite。最小表集合：

| 表 | 内容/规则 |
| --- | --- |
| metadata | schema/app identity、fundingID、profile/route/price/初始授权 hash；不可更新/删除 |
| authorizations | 初始授权及追加修订的原始结构、hash、前驱 hash、顺序；只追加 |
| reservations | callId、reservationId、dispatchPermit hash、owner host/profile 或 executor/job、route/request/session hash、上界、预留金额、原 lease nonce、时间；只追加 |
| settlements | 每个 reservation 的唯一原始 usage/finish/error/费用/unknown 判定及 hash；只追加，重复完全一致幂等，不同回执冲突 |
| events | 初始化、lease、停止、异常和授权操作的有序元数据；不存 prompt/thinking/秘密 |
| lease | 单行当前所有者 nonce、PID、阶段、受信进程 creation identity、最近 UTC 高水位；事务 CAS 更新 |

资金派生式为有效累计授权减去已知费用、未结预留和未知占用。unknown 不计零；异常 usage 超界时占用至少为预留与可算费用的较大值，并全局停止。判断未结状态用记录计数，不能只检查 held 金额是否大于零。

每次 reserve 在 `BEGIN IMMEDIATE` 内检查原授权、绝对期限、绑定、lease nonce、未知/未结状态、callId 唯一性、完整预留余额，再插入一次记录。先提交预留后派发。金额/状态计算和插入在同一事务，不能先读余额再分开写。

运营进程只持有一个资金 lease；与 Host 的 profile lease 各自约束不同资源，不能彼此冒充。已有 PID 仍活着或身份不可确认时拒绝抢占，不靠超时/heartbeat 过期就覆盖；PID 被复用时也保守拒绝。确认原进程已不存在且无未结/unknown，才允许 CAS 记录原 lease 结束并取得新 nonce。

最小启动兼容现工厂：资金 lease 先进入 `starting`；其 guard 允许只读预检，但 reserve 始终拒绝。`createProductionRuntime` 取得真实 Windows parentProof 后，固定 launcher 用 PID/creationId/Node hash/SID/token 证明激活该 lease，再调用 ManagedHost.start。这样不需要第二个 probe helper，也不会在 OS 证明前开放资金许可。每次 reserve 都要求已激活的同一 nonce，caller 无法从 JSON 请求激活。

绝对期限不因重启重算。运行时同时夹住绝对 UTC 余量与本次启动的单调时钟余量；持久 UTC 高水位倒退即停止，不能通过时间回拨延长窗口。运营窗口不暗中继承或改写 7C 的累计 6 小时规则。

## 6. reserve、settle、恢复与追加

`OperationsModelBudgetAuthority` 实现已有 `ModelBudgetAuthority`，kind=`operations`，authorizationId 为固定 fundingID；每个增额记录另有 revision/authorization ID 和前驱 hash，不能以新 ID 逃开旧调用。父和全部 child 只取得同一个 authority 和 `SharedModelBudget`；工具许可仍另验活 Core grant。

FIFO 继续只覆盖单次 reserve→模型→settle。排队无预留，signal/期限到达退出；不得锁整个 Run 让父等待持有同一锁的 child。模型调用次数不加上限。每次许可绑定实际 request/call/job，不预生成启动用的占位 job。

settle 不依赖当前任务 grant、未过期窗口或仍有余额；它只核对原调用、reservation、原 owner 与精确回执。模型已给出终态后不再用派发期限取消结算。缺/非法 usage、error/aborted/interrupted、断链和费用不确定保留 unknown；结算 ACK 丢失不能换 callId 或重发模型。

重启只读保留原 reservations/settlements；遗留 reserved 按不确定占用展示并阻止启动业务，不退款、不清零、不自动“按最大值已付”、不转换成新调用。收集后续真实账单也只能追加具有来源的显式核对记录；本最小步骤不实现自动 unknown 解封命令。

operator-amend 必须有新的真实授权材料、固定 fundingID、原授权链末端 hash、增额整数与理由；原绝对 expiresAt/price/route/profile binding 不变。事务内检验没有活动 lease/未结调用，再追加并重算上限。增加额度仍不能清除 unknown 停止。原窗口过期、价格或绑定要变更，先停止并另做明确方案，不提供无条件滚动新窗口。

## 7. start/run 与关闭顺序

1. 严格解析参数和业务 request，完成纯文件/数据库检查；校验资金初始化凭证、原授权、price、路径与固定代码 pins。模型凭据只验证明确绑定/hash，不输出/复制密钥。
2. 打开 existing-only 运营库，取得 starting lease；guard 此时只供启动预检，不允许 reserve。
3. 调用固定 production factory，预热真实 Windows proof；验证 parentProof 并激活相同资金 lease。任一失败关闭已取得资源并记录终止阶段，不能继续 ready。
4. ManagedHost.start 使用 factory.hostOptions；await 模型 metadata 预检与唯一父 hook；Core/Memory/渠道激活后使用正常 DSH 会话。child 原固定 launcher/IPC 向同一 authority 请求许可。
5. SIGINT/SIGTERM/期限/未知先关闭新准入，停止新的渠道/自主工作，取消当前 Core/Memory/Media/Bili/Executor 实际控制器；已有费用结算不受取消拒绝。
6. 按现有 `RuntimeResourceLifetime`：Host.close/实际调用排空 → 费用回调结束 → Windows helper 关闭 → CLI 持有的运营库写 lease 终止并关闭。未确认排空不得释放 proof/lease 后宣称停干净；保留失败状态和诊断，重启按原未结规则拒绝。

共用工具层计费没有给管理员任意程序建立 OS 沙箱。本方案只证明固定受信 Host/child 模型路径的准入；不把管理员任意代码、脱离子进程或系统其他模型客户端的费用声称为已受此窗口约束。现有 Windows treeContainment=`not-enforced` 与未知效果语义保持。

## 8. 本机零模型验证与相关测试

### 实际 Windows factory 装配检查

由根代理统一在本机受管 D 盘目录运行，限定当前用户实际 Node 与固定 PowerShell/probe，windowsHide=true。若当前 token 不满足管理员/SID约束，记录真实拒绝结果，不能用布尔替身冒充实际通过。

测试创建独立空 profile、公开虚构人格、仅合成 `DEEPSEEK_API_KEY` 的 selected-only 凭据文件、明确 `synthetic-validation` 的资金材料和有限测试整数。它们不能进入生产 operator-init，也不是新增运营授权。已有真实凭据、QQ/Bili session、7C目录均不读取/使用。

通过测试专用程序调用实际 `createProductionRuntime`、WindowsProcessControl 和官方 Host/provider：program-only 注入的合成资金 port 只允许 metadata/guard，reserve 无条件抛出 `LOCAL_FACTORY_MODEL_DISPATCH_FORBIDDEN`；标明其 kind 字段只覆盖生产装配分支，来源仍为 synthetic，不能从正式 CLI 选中。金额无论多少均不提供派发能力。

准备无业务任务、无待恢复 work、无渠道/Activity/夜间唤醒的专用 profile。实际工厂完成父 token/程序 pins、模型 metadata、单 hook 和 Host 生命周期后立即有序关闭；不启动执行任务，不生成“已完成业务”的回执。测试进程另以仅测试使用的零网络守卫统计 fetch/socket，任何意外调用即失败；不能以网络被阻断但曾尝试调用当作零调用通过。

正向证据：实际 parentProof（SID/PID/createID/Node/probe hash、elevation/admin），Host hook 先安装、模型派发数=0、资金 reservations=0、child模型=0、平台=0、正常关闭且 helper退出、临时文件受管清理。该检查验证真实本机 factory 与 OS 资源生命周期，资金仍为合成、HTTP仍未验收。

负向检查：Node/probe hash错、SID错、default output/context/effort不匹配、凭据 binding缺失/hash变化、synthetic funding传正式CLI、过期/未知/缺库、异常额外CLI参数；均须在业务/模型派发前拒绝。真实子进程权限与 child stdin/IPC 链沿用独立 executor 验证，不能用父 proof替代 child proof。

### 定向测试清单

| 组 | 必需证据 |
| --- | --- |
| CLI parser/离线入口 | inspect/status/Host init 不调用模型、网络、proof factory；missing库不生成；任意模块/参数拒绝 |
| 一次 init | 新显式授权成功一次；重复/换路径/缺库/缺凭证/initializing崩溃窗口拒绝；旧数据不写 |
| 整数与原子资金 | 额度边界、缓存分桶、reasoning不双算、安全整数溢出、上界预留；并发 reserve只一笔提交 |
| 共享与恢复 | 父/多个真实job同库、任务绑定不变、撤销后结算、ACK幂等/冲突、重启held/unknown不释放 |
| lease/期限 | 第二进程拒绝；dead-owner CAS 与 PID不明保守拒绝；绝对期限/UTC倒退；starting不能派发 |
| 追加授权 | 无文件不自动增额、错误前驱/不同route或price拒绝、旧记录hash不变、增额不解除unknown |
| 实际Windows装配 | 上述真实helper+官方SDK、合成资金/凭据、零派发/零平台与有序关闭；明确未付费 |

现有 gate 11、evaluation router 5、原 executor budget 4 及模型/Memory修复后 8 项结果保留；只因接口或逻辑变更重跑受影响组，不把此前通过扩写为新CLI/运营库已通过。共享构建与受管测试仍由主代理一次执行。

## 9. 实施子步骤与后续真实门槛

建议顺序：先严格 schema/read-only inspector 与 operator-init 事务；再 existing-only authority/lease/追加授权及离线财务状态检查；随后固定 thin CLI 接线与真实Windows零模型装配。每子步定向验证、记录、提交。新增文件集中在 server-runtime 的 launch-config、funding-store、operations-authority、cli 与固定 bin；不向 server-bootstrap 引入 Host 依赖。

服务器付费验收仍必须二选一：受信通道由本机原 7C 单协调者逐调用预留/结算且保持原时钟，或另有用户明确批准的服务器运营资金窗口。现有同机 Node IPC 不等于跨服务器预算通道。本步没有其中任一授权/通道时，只能部署代码准备与离线验证，不能付款派发，也不能把合成本机检查写成真实模型/平台验收。
