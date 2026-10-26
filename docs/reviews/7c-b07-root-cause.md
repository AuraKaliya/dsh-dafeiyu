# 7C B07 持久阻断缺失：只读根因分析

2026-10-26。本报告是 AI 对代码与两份已关闭真实尝试的分析，不是独立人工语义验收。本阶段未读取模型内部思考、调用模型、构建、运行测试、连接服务器、修改产品或评分标准，也未重写原始结果。

结论：两次都在“识别缺失信息”之后漏掉了“登记任务异议”这一步。登记工具实际暴露且其参数契约可表达本场景，未出现调用它后被权限、Schema 或存储拒绝的证据。现有产品把状态登记交给模型主动选择，但执行规则没有明确说明口头缺口说明不等于持久任务状态，工具描述使用“可阻塞”。工具失败本身也不自动生成 TaskIntent。因此，**最有证据支持的是模型使用协议与任务状态衔接不足**；不能仅凭静态分析保证补充文案必然解决，也不能断言已排除所有潜在实现缺陷。

## 证据范围

| 样本 | 原尝试 | 结果 |
|---|---|---|
| B07-paraphrase-1／REVIEW-009 | `024e2497-98ba-427c-8a2f-0ddd7b98a88e` | failed，唯一失败检查为 `missing-total-blocked-specifically` |
| B07-neutral-1／REVIEW-034 | `35d22913-984d-4550-b58a-7a581be81e20` | failed，同一检查失败 |

材料位于 `.runtime/acceptance/7c-20261026/cases/<attempt>/`：`case.json`、`answer.json`、`program.json`、`profile.json`、已关闭 `profile/core/runtime.sqlite` 和 `profile/memory/memory.sqlite`，以及对应真实回答会话的 `session.v4.jsonl`。只提取 system/user 可见输入、request/header 工具定义、tool/call 与可见答案；没有读取或分析内部思考。

两份 profile 各 10 个文件的字节数及 SHA256 均与清单匹配；两份清单聚合哈希匹配，未见 WAL。SQLite 以 readOnly 和只读事务打开。两份 program.json 的 SHA256 分别为 `248ad380d269186c458ebb89b9ce7680a70051b794591521b6d8a3c294c53729`、`005d1ba5ec002ef932571446ba276d8083d6fb8404751765acaf324b76a031f1`。

冻结 suite 的 SHA256 为 `1598c1d0507495005e6762158952f38ea7dfaaa3a5bf2cc4fb40a8346972711a`，当前源文件与 campaign 配置一致。所检查的产品、契约、B07 driver 和 fixture 文件在两样本候选 `525deda` 与 `15c38e2` 之间，以及后者与本次读取的工作区之间没有差异。因此不能把本次差异归为两版 B07 实现不同。

## 实际发生的路径

1. 冻结场景提供一月 12、二月 8、三月缺失，禁止补造，允许先整理已有月份。初始准备任务的 epoch 为 1，正式问题更新为 epoch 2。
2. 两份真实会话的 `request/header`（seq 8）均暴露 15 个原生工具，包含 `dafeiyu_task_intent` 和 `dafeiyu_task_object`。后者明确列出 `missing-information` 类别、`blocking`、`actions`；`evidence` 可省略并默认空数组，不存在必须凭空构造证据 ID 才能登记的接口要求。
3. 两次真实调用完全相同：seq 13 `fixture_known_rows({})`、seq 15 `fixture_receipts({})`、seq 24 `fixture_total({})`。没有 `dafeiyu_task_object` 调用，也没有该工具被拒绝或失败的记录。
4. `fixture_known_rows` 返回已知小计 20、缺失月份 `[3]`。`fixture_total` 返回 `failed`、`effects:none`、`FIXTURE_MARCH_MISSING`，没有确定总量写入。
5. 可见答案均区分小计 20 与完整总量，说明三月缺失，没有把未知当成零或声称完整总量已经成功。此观察只说明答案中的这些事实边界正确，不等于完成正式语义评分。
6. 两个 memory 库的 TaskIntent 各只有两条 `accepted`（准备 epoch 1、正式 epoch 2），均 `blocking:false`，没有 objection/resolved。正式 Run 均为 `completed`，error 为 null；这只是实际运行状态，不应解释成所有业务目标已经达成。

## 接口、接线与状态转换

| 候选原因 | 证据与判断 |
|---|---|
| 工具没有暴露或策略不可达 | 不支持。`scripts/evaluation/runtime.ts:24` 将两项任务意图工具纳入 EXECUTION_ACTIONS；`real-boundary.ts` 正式策略允许这些动作和 local-write；真实 request/header 已证明定义进入请求。 |
| 参数设计无法表达局部阻断 | 不支持。`packages/contracts/src/execution-memory.ts:40` 接受 `category:missing-information`、`blocking:true`、`actions:[相关动作]`、可见 reason，evidence 默认空数组；无需更改任务目标。 |
| 登记后存储丢失或拦截失灵 | 这两次没有走到该路径，不能以其失败证明该问题。`packages/memory/src/execution-memory-state.ts:95` 以后将 objection 以 taskId/epoch 追加到不可变事件表；`intent()`读取当前 epoch 未解决的阻断。这里没有任何登记尝试。 |
| 工具错误应自动等于持久阻断 | 当前接口并非如此。`packages/contracts/src/execution.ts:40` 的 ActionOutcome 描述状态、effects、completeness、data、sources、receipts、errorCode，未包含可直接转换的“哪些前提未满足、应阻断哪些动作”契约。`execution-coordinator.ts:488` 保存错误回执后继续模型运行，没有自动追加 TaskIntent。 |
| 模型知道缺口却未使用状态接口 | 由调用与结果直接确认。原因层面的最佳解释是使用协议不足，不能从这些记录推断模型隐藏的决策过程。 |

`packages/core/src/execution-coordinator.ts:479` 只在已经存在未解决的阻断异议时拦截相关写动作；读取与不相关动作仍可执行，登记异议本身不被该门禁挡住。`execution-coordinator.ts:432` 在模型返回后检查 `memory.intent(access).blocking`：有阻断则 waiting，否则 complete。两次没有异议，因此得到 completed 与现有代码一致。失败回执保存在 run_operations 中，但它不等于活跃的动作阻断。

现有测试源码 `tests/execution-memory-continuity.test.ts:73` 覆盖主动登记后相关写被挡、独立写继续、等待受信解决；`tests/tooling/evaluation-real-drivers.test.ts:22` 在脚本后端直接指定 B07 调用 object。这些说明实现意图及既有测试覆盖方向；本分析没有运行它们，脚本强制选工具也不能证明真实模型会自行选择。

## 提示与契约之间的缺口

`packages/core/src/native-runtime.ts:43` 的执行规则涉及来源、权限、真实回执、内部结果交付和未知效果不重发，没有说明遇到仍待条件的任务部分需要登记持久 TaskIntent。实际 system/message 与此一致：底色要求说明信息缺失的影响、继续安全部分，但未出现 `dafeiyu_task_object` 或持久阻断操作说明。

`packages/memory/src/persona-service.ts:118` 的工具描述是“记录异议……前提、信息和权限问题可阻塞列出的相关能力”。它说明能力，却没有清楚说明何时必须调用、口头解释不能替代登记，以及部分答案交付后仍须保存未完部分。两次模型完成了读取、尝试失败和文字解释，状态协议却没有闭合。这是目前最小且可操作的产品改进位置。

另有一项场景语义差异：paraphrase 的目标是“目前的数据能支持怎样的合计结论？哪些步骤仍待条件，哪些可以先交付？”，偏向现状分析；neutral 明确请求计算三个月总量。driver 把每种措辞直接作为新的 Task goal，而非保留同一计算目标、把变体当本轮提问。因此 paraphrase 的解释性答案本身可能已满足其表面问法，持久未完任务义务更依赖既定产品协议。这个歧义值得未来版本单独验证，但 neutral 也失败，不能用改写问法解释全部缺口。

## 评分是否过具体

原冻结 suite 的 B07 program 已含“阻断绑定相关动作”，`docs/persona-growth-continuity-plan.md:88` 的规则也明确要求 Task 上独立记录异议及影响步骤。要求持久、局部的状态有事先依据，不能因口头说明正确就追认原 failed 为 passed。

当前 `scripts/evaluation/real-boundary.ts` 的检查也有检测局限，但它们不构成这两次的误判证据：

- `events.some()`通过字符串同时包含 `fixture_total` 和 `"blocking":true` 判断，没有结构化核验 kind、当前 task/epoch、actions 数组与未解决状态。它可能把原因文字、旧 epoch 或已解决记录误当有效局部阻断，实际上偏宽松。这两次连 objection 都没有，更严格的状态断言仍不会通过。
- `fixture_total` 的 fixture 实现始终抛缺失错误，无法仅凭“没有写入”证明产品门禁挡住了错误动作。
- 本场景没有后续执行去实证跨轮／重启持久拦截，也未提供独立的本地整理写动作去实证“无关写继续”。状态存在、实际门禁、继续独立工作是不同层级的证据。
- 离线 B07 检查主要验证未写总量，脚本后端又预先指定 object；既有离线通过不足以说明真实任务状态闭合。

保持原标准与两份失败。未来如加强断言或修订夹具任务语义，应作为明确的新协议／新候选及新结果，不能改原证据或把新检查反写成旧批次已通过。

## 最小修复建议与复验范围

首选最小产品修复是补齐通用执行协议与工具描述，不改底色、冻结样本、原答案或评分：

1. 在原生任务执行规则中明确：若已受托目标仍有因信息、前提或权限缺口无法完成的部分，完成本轮报告前应通过任务异议能力保存可见原因及受影响动作；文字解释与部分结果不自动解除该状态；安全的独立部分继续。
2. 在 object 描述中说明 `actions` 应限定实际受影响能力，只有确实影响整个任务才为空；偏好／方法建议不得阻断。查询已有 intent 以避免重复登记；解决仍由受信生产者确认。
3. 避免加入“三月”“fixture_total”或评分类别等样本提示；不要将每个 failed/partial 工具结果一律自动变成阻断。错误可能已由替代路径解决，或只是任务的一次可选探查。

这是待验证的最小方案，不是已完成修复。如果真实模型仍稳定遗漏而产品需要程序级保证，才考虑版本化的结构化前提缺口回执及受信核心转换；需明确来源、动作范围、解决方式和去重，不能靠字符串匹配错误码或答案补造异议。此方案超出最小文案修复范围。

复验应分层并保留原失败：

- 相关离线集成：TaskIntent 登记／局部动作门禁／独立动作继续／可信解决／同 epoch 接续与重启；偏好方法不阻断；未知效果不重试；验证真实请求头仍暴露完整工具契约。脚本后端结果明确标记为模拟。
- 新候选真实诊断：优先重验这两个明确失败样本，再覆盖 B07 压力形式；新 attempt 关联原失败、费用与版本，不能用随机重抽覆盖原评分。B07 最终受影响矩阵为三种形式各三次，共 9 项。
- 防止过度阻断：B06（非阻断建议仍交付）、B05（仅明确任务才受理）以及 H01 未完事项／约定、H05 效果与重放边界是紧邻回归重点。
- 全局影响：若修改 native-runtime 通用规则或通用 object 描述，所有使用该原生任务协议的 B/H 场景都改变了模型输入，须重新冻结候选并完成对应真实校准。不能只跑 B07 就宣称旧 7C 全部结果适用于新产品版本；完整接受范围需按共享提示影响制定，不能沿用仅历史夹具变化的窄范围复用证明。

以上仅给出后续修复与验证建议；本报告没有实施它们，没有更改冻结标准或原始失败。
