# R6 只读研究：headless CLI 的费用观察与预算准入

2026-10-26。仅核对本机已安装包、对应源码及本项目计费代码；没有启动 DSH CLI、模型、测试或服务器，没有读取凭据文件或实际思考内容，没有修改源码。当前校准与原候选保持冻结。本页为 R6 设计输入，不是接入验收结果。

## 结论

**不能靠 `headless --json -` 的输出给外部 CLI 做逐调用预算准入。** 最小可行路径是：专用 child profile 加一个受信 `llm/stream` 插件，在 `next()` 前通过 Node IPC 向父执行器申请原账本的预留；父端继续是唯一 `EvaluationLedger`、lease 和时钟所有者。费用归一化与失败处理复用现有 `billing.ts`，只补小型受信端口和进程桥，不另造子费用账本或模型循环。

同进程创建独立 DSH Agent 能直接复用同一个计费钩子，结构更小；但它不提供 CLI 子进程的进程／生命周期隔离。若 R6 已选择 headless 子任务，IPC 方案符合现有 profile 和 middleware 接口。所检查的 SDK stdio 接口提供会话事件和生命周期，不提供现成的远程逐调用预算否决，单换 SDK 不能省掉受信准入钩子。

## 1. 本机可核的事实

本机命令搜索未发现 PATH 中的 `dsh`。实际安装包位于 `D:/DSH/DSH Desktop/resources/app/node_modules/@deepseek-ai/`；其中 `dsh/package.json` 和 `dsh-headless/package.json` 均为 **0.2.1-rc.2**。`D:/DSH/deepseek-harness/` 中对应 CLI/headless 源码同样标为该版本；以下先以实装代码为证据，源码帮助解释。

| 接口／事实 | 证据位置与限制 |
|---|---|
| headless 简写有效 | 实装 `dsh/lib/bin.js:22` 明确 `dsh <name>` 是 `--profile <name>` 简写；headless startup 接受 `--json`、`--session-id` 和任务 stdin。 |
| JSON usage 是 step 合计 | 实装 `dsh-headless/lib/json-stream-BA-F3lfb.js:200` 累加 `assistant/attempt`，`:215` 在 `step_end` 发 usage。对应源码 `packages/bundle/headless/src/json-stream.ts:201` 附近说明：任一尝试缺 usage，整步省略总数；可选 bucket 仅在每次都报告时保留。 |
| JSON 不是全量模型账单 | 同文件只在 `session === agent.session` 时处理事件；session 输出含 sessionId/cwd，step 输出含 turn/step/usage，未输出 provider/model 或逐 attempt 调用 ID。摘要、标题和独立子 Agent 的模型调用不能假定在这条根会话投影中。 |
| JSON 包含思考事件 | 实装同文件 `:205` 输出 `type:'thinking'`。非 JSON 路径还会把 reasoning 写到 stderr；headless `index.js:295` 起的运行逻辑和对应源码 `src/index.ts:363` 区分两条路径。不能保存原始 stdout/stderr 当作安全验收日志。 |
| 可在 profile 中装插件 | 实装 `dsh/lib/profile-boot-C14i-8IN.js:245` 读取 overlay，`:303` 使用 profile patch 启动树；headless `lib/index.js:295` 等待 Loader 完成后才创建 Agent。profile 自己的 patch／固定 overlay 可以装受信插件，无须改 DSH 循环。 |
| 每个模型 dispatch 有钩子 | 本项目实装 `node_modules/@deepseek-ai/dsh-llm/lib/index.js:2397` 通过 `ctx.waterfall(...,'llm/stream',options,next)` 才进入 adapter。`lib/types/index.d.ts:25` 附近声明钩子；LOOP 请求被冻结，只读，不应改写提示。 |
| async 阻断成立 | `node_modules/@deepseek-ai/cordis/lib/index.js:308` 说明不调用 next 即否决下游；当前 `scripts/evaluation/billing.ts:16` 已使用 async generator，在 `:23` 预留后才于 `:26` 调用 next。可以在同一位置 await 受信 IPC 应答。 |
| Node 有独立 IPC 通道 | 本项目 `node_modules/@types/node/child_process.d.ts:624` 的 stdio 支持 `ipc`；`:312` 起声明 send／message，`:1278` 起解释 Node 子进程 IPC。可用固定 Node 与 CLI 路径、`stdio:['pipe','pipe','pipe','ipc']`、`windowsHide:true`；具体组合仍须纯脚本验证，不能用 stdout 冒充 IPC。 |
| Host 现有观察不够计费 | `packages/host/src/runtime.ts:51` 的 onModelCall 是同步状态回调；`:106` 只报 provider/model/purpose 和 started/completed/failed，无 usage、异步准入或费用结算。 |
| 旧 task-budget 只计数 | 管理中心历史镜像 `调用限制解除开发/程序/task-budget/index.js:7` 的 llm/stream 只 `calls++`、写 `limit:null` 后 next；package 为 1.0.1。它不是费用预算器，也不应恢复旧每轮调用次数上限。 |

以上本地包和历史镜像不证明服务器当前路径、版本、profile、凭据装配或进程身份；正式接入时仍须读取服务器现状。

## 2. 最小装配与调用顺序

1. 父执行器使用当前已获准的 Task／Run／operation／attempt 绑定创建一个 child job，固定 Node、CLI、专用 profile、cwd 和允许的路由。模型不能指定预算账本、attemptId、CLI 路径、环境变量、授权额度或 IPC 身份。原 campaign 仍只有父端写账本。
2. 专用 profile 挂受信预算插件，注入 llm，先安装全 child ctx 的 middleware，再完成父子 ready 握手。把 headless runner 与预算 ready 服务建立明确依赖；父端在握手成功前不结束任务 stdin。插件缺失、初始化失败、路由不符或 IPC 不可用时不得开始任务。不能依赖 YAML 行顺序；base patch 明说激活由服务可用性决定。
3. 每次 middleware 收到 GenerateOptions，复用当前路由、contextWindow、maxTokens、reasoningEffort、requestBytes 校验；本地计算 requestHash/sessionHash。只发送小型结构化 metadata，不发送 key、完整提示、工具正文、replayState 或 reasoning 内容。
4. 父端按真实 child process/channel 和固定 job 绑定校验 metadata，再调用原 `ledger.reserve`、写 started call，成功后返回本次许可。**收到许可前绝不 next()**。每个根请求、自动重试、摘要、标题及同进程派生 Agent 请求均须经过同一钩子；不得仅按 headless step_start 计数。
5. middleware 只观察 usage 和 finish 的受信字段，按现有规则归一化并提交 settlement；父端 `ledger.settle`、写 finished call 后应答。模型输出继续走原 DSH 流，不以计费插件改写模型循环。结算应答完成前不开始下一模型调用。
6. parent 继续持有原执行区间；child 的运行与等待都包含在该区间内，不另启 6 小时或 48 小时时钟。到达原 deadline、Task 撤销、IPC 断开或父进程退出时，child 取消当前调用并拒绝下一次；父端处理实际在途／退出，不能把 kill 或 exit code 当作零费用证明。

必要消息仅为 ready、admit、permit/deny、settle、settled、cancel。关联字段可用 jobId、callId、reservationId、固定 route、bound、request/session hash、purpose、usage buckets、finish 与稳定错误码。身份来自父端登记和继承 IPC 通道，不来自 stdout 字符串或模型参数。父端把 child job 与已有 EvaluationCall.id 的关系保存为证据；无需另建权威费用表。

`billing.ts` 当前参数是具体同步 `EvaluationLedger`，不能把异步 IPC 对象直接类型伪装成它。实施时只需抽出既有请求描述／usage 归一化，并把 reserve/settle/record 的调用点接到一个受信可 await 端口：本进程实现调用原 ledger，child 实现发送 IPC；父桥仍调用同一个 ledger。`totalUsage` 已正确把 disjoint 的 uncached＋cache-read＋cache-write 合计为 input，reasoningTokens 属于 output，不再重复加费。

## 3. 保留的预算与失效语义

- 用户追加授权后的 50 元是当时的剩余额度起点，不能把 child 当成另一份 50 元。实际准入读取原 `.runtime/acceptance/7c-20261026` 的最新余额、增额授权与原 6h／48h 时钟；原 config 60 元、effective 累计 97.894922 元的历史不重写。
- `ledger.ts:120` 的 reserve 已检查额度／阶段／时钟；`:122` 拒绝未知费用和重复 requestKey；`:123` 只允许一个 reserved；`:127` 的首次调用时间使用 coalesce。child 不打开 SQLite、不持有第二个 lease、不自行声明余额或把 maxTokens 当作真实用量。
- 最小版本继续全局单个实际模型派发。父人格调用结束并结算后才执行 child；child 的内部调用也逐次结算。若辅助调用并发，父端等待现有 reservation 完成或明确拒绝，不能并发绕过原账本。仅因在途预留暂时不足不能写成最终预算耗尽。
- usage 缺失、格式不一致、error/aborted、进程或 IPC 中断按当前 billing 语义记 unknown，停止新准入；已发出的其它回执仍须收齐。不要把 headless 缺 step usage、exit 0、final 文本或 stderr 为空转换成 0 元。
- reserve 对重复 requestKey 会拒绝，settle 对相同用量可幂等。IPC 重复／延迟／冲突消息不得再次派发；父进程恢复不能复发旧 permit 或自动重放子任务。丢失 settlement 的旧 reservation 由原恢复／已授权 unknown-at-maximum 流程处理，仍明确 actual fee unknown，不删除历史。
- 不恢复 32／12／4／6 等每轮调用次数上限。诊断计数可保留；停止依据仍是金额、期限、取消、来源或执行状态。有限输出 bound 用于费用预留，不等于限制每轮调用次数。
- 所有付费子调用必须归属于原账本里一个真实获准的父 attempt。现有配置的 case 列表被冻结；预算端口本身不授权新增 QA case，不能借用某个旧 CAL attempt 隐藏新执行器 QA。R6 应先闭合准入 case／阶段／证据分类，再决定是否付费。

## 4. profile 与证据边界

专用 profile 固定模型／effort／输出上界；检查自动标题、摘要、重试和子 Agent 能力。base 默认包含 session-title-llm 与 llm-retry：可在 QA profile 关闭不需要的辅助能力，保留的调用仍须全量计费。provider 自动网络重试应按已核验的当前计费方式配置；不能把“没有根 step_end”理解成“没有模型请求”。

stdout 仅作受控结果核对：先按事件类型过滤，thinking 直接丢弃，不回传给评阅代理、不落日志；只保留必要 session/status、实际工具 ID／状态和经处理的最终可见结果。工具参数、错误消息和 stderr 可能包含敏感文本，不能整段追加到报告。费用权威始终是受信钩子与父账本；stdout usage 仅作可选交叉核对，不再结算一次。

这一设计依赖受信且冻结的 CLI／profile／插件，不是针对任意管理员代码的 OS 沙箱。若 QA 同时允许任意 shell 读取凭据、替换预算插件或另启带凭据的模型 CLI，仅加 middleware 不能证明所有网络费用都被捕获。R6 必须保证 QA 的模型路由只能经受信入口，执行器工具不能改预算／profile／凭据或调用另一条模型通路；若保留无约束管理员能力，应另行提供可验证的执行／网络边界，不能声称提示词已经封住费用绕行。

## 5. 无模型验收方式（尚未执行）

使用主代理的受管 D 盘测试入口，不接真实 provider、不传真实 key、不安装到在线 profile：

1. 纯 Node IPC 假 child 只发送固定元数据。父端未授权、额度不足、原时钟到期或错误 job/route 时，child 的 simulated dispatch 计数必须为 0。
2. 用本项目 `EvaluationScriptedAdapter`／假的 LlmAdapter 挂真实 Cordis llm middleware。parent reserve→permit→dispatch→usage→settle→ack 顺序完整，且主请求、独立 session、compaction/session-title 目的及重试均逐次登记。
3. 验证 cache buckets、totalTokens、reasoningTokens 归一化与现有 `evaluation-real-billing.test.ts` 一致；error finish 即使带部分 usage 也按现有 unknown 规则处理。
4. 缺 usage、父／子退出、取消、断 IPC、重复 admit、重复或矛盾 settlement、旧 permit 重放，都不能产生第二次未预留调用；unknown 不被 final/exit 0 清除。
5. 固定 profile 启动用脚本 provider，不装真实 provider；预算插件缺失或 ready 未完成时不给任务 stdin，验证没有模型请求。再验证无凭据的真实本机文件／命令样本，不把它称为模型验收。
6. 以合成 thinking、正文和假 secret 哨兵检查输出过滤；报告只含允许的元数据和可见结果，没有原 stdout/stderr、思考块或凭据。
7. 父、child 两个来源轮流消耗同一合成 ledger，验证合计额度、阶段、firstCallAt/expiresAt、activeMs 不因进程新建而重置；不产生第二份权威费用账本。
8. 保持调用次数不设旧上限：用多次低成本脚本请求证明不会在旧计数阈值停止；由已有金额／时限控制停止即可，不需要为了此点运行真实模型。

## 证据补充入口

- 源码版 JSON 行为：`D:/DSH/deepseek-harness/packages/bundle/headless/src/json-stream.ts`；现成测试 `tests/json-stream.spec.ts:314`、`:374`、`:382` 验证重试合计和 usage 缺失。
- profile 安装／启动：`D:/DSH/deepseek-harness/apps/cli/src/profile-boot.ts:323`、headless `src/index.ts:311`、headless/base 的 `cordis.patch.yml`。
- SDK 范围：`D:/DSH/deepseek-harness/packages/sdk/server/README.md:52`、`packages/sdk/client/README.md:52`。这里读到的是会话通知与 route/maxTokens 初始化，不是父端逐调用预算授权接口。
- 现有费用实现：`scripts/evaluation/billing.ts:11`、`:23`、`:35`；`ledger.ts:120`、`:130`；`real-runtime.ts` 的 DeadlineAdapter 和固定路由装配。
- 旧 CLI 只作历史参考：管理中心 `自主更新保护开发/程序/qq-bridge-v073/lib/cli-server-tasks.mjs` 的 spawn 与 JSON 解析；不能照搬其凭据环境、并发数或直接人格交付路径。
