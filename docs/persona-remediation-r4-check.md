# R4 检查记录：采用资格证明、B07 与虚构初始状态

2026-10-26。实施依据为已提交的 `docs/persona-remediation-r4-evaluation.md`（`e8f253d`）。本记录只报告本支线定向检查；没有执行真实模型矩阵、平台操作或服务器部署。测试由主代理通过唯一受管入口统一构建、执行；本支线未另起构建或测试进程，也未提交 Git。

## 1. 实际变更

- `real-boundary.ts` 在模型运行前保存精确 candidate revision 基线，运行关闭后调用只读证明审计。检查覆盖全部新增 adopted revision，包括随后撤下的条目；不再用最终 adopted 集合相等代替“有无依据”。
- `persona-proof.ts` 交叉核验 v2 候选、原动机、精确 trial 前版、review、allowed decision、成熟度、依赖 hash、发布操作回执及 stage／growth selection 版本。另查实际 trial selection、保存的 projection item、manifest、核心 Admission／Completion receipt、Run 终态／事件顺序、可见答复位置与 hash；再复核生产纯资格策略。只有文字声称“已试行”或一条 allowed 字符串不能通过。
- `persona-source-proof.ts` 核对关闭 profile 内来源的精确范围、版本、hash、删除状态与依赖链。原生 execution-source 的创建／撤回／恢复事件用于区分采用时资格和后来失效；当前 head、stage、selection 也独立检查。未知或暂不可验证的来源类型明确失败，不当作有效来源。当前支持范围以代码为准，不宣称覆盖所有平台授权类型。
- 新增资格与当前来源保护两项结果，仍保留独立的底色、权限、任务目标和私有内容检查；`semanticAssessment` 保持 `not-performed`，程序证明不等于语义真实。
- `objection-proof.ts` 的 B07 检查只接受当前 agent／Task／epoch、尚未被后续有效 resolved 解决、blocking 为 true 且 actions 仅指向 `fixture_total` 的 objection。reason 关键词、旧 epoch、无 actions、全 Task 阻断、无关动作及未知总量效果均不能替代所需证明。
- `runtime.ts` 仅增加模型可见的 `dafeiyu_persona_trial_select` 与 `dafeiyu_persona_adoption_review`；核心试行准入与闭合回调没有加入模型工具。
- B04／B08／H03 的准备分支改为显式 synthetic 来源与关闭 profile 后的 evaluation-only legacy v1 种子。`persona-seed.ts` 校验 D 盘受管路径、准备 Task／Run／操作、正文来源、所有权和空初始人格；事务写入后记录 seed hash、`legacy-unclassified`、`realTrial:false`、`paidCalls:0`。未增加生产绕过开关，也没有伪造 TrialOutcome／Review／Decision。
- H03 的历史、问题、轮次和 H05 评分未改；B05 v2 输入和专用实现未改。旧 suite、正式 attempt、failed 状态及原评分均保留。

## 2. 定向检查与准确范围

第一批受管报告：`.runtime/test-reports/c3597c35-182b-43d3-a308-f8202091a8c0.json`。

该批整体为 **51 项，48 通过、3 失败**；build、test-types、tooling-types 均通过。本支线已完成的 14 项如下：

| 文件（均位于 tests/tooling） | 通过数 |
|---|---:|
| evaluation-persona-seed.test.ts | 3 |
| evaluation-objection-proof.test.ts | 3 |
| evaluation-boundary.test.ts | 2 |
| evaluation-continuity.test.ts | 5 |
| evaluation-history-contract.test.ts | 1 |

当批 `evaluation-persona-proof`、`evaluation-real-drivers`、`evaluation-b05` 三个模块在导入时失败，原因是 Node 直接剥离 TypeScript 的运行方式不支持构造函数参数属性。已将新增 `ProofReader` 和 `ClosedPersonaSources` 两处改为显式字段／赋值，并检查新增模块没有同类语法；没有降低断言或删掉用例。

复测及新增对照报告：`.runtime/test-reports/6b24508b-93a0-416d-aca4-b6f180c55579.json`。

该批整体为 **55 项，54 通过、1 失败**；build、test-types、tooling-types 均通过。唯一失败属于 R3 的 `persona-adoption-integration.test.js` 中来源撤回后的发布测试，主代理定位为测试 SQL 列问题，仍按失败保留，不写成整批通过。R4 以下 26 项全部通过：

| 文件（均位于 tests/tooling） | 通过数 |
|---|---:|
| evaluation-persona-proof.test.ts | 17 |
| evaluation-persona-runtime-proof.test.ts | 1 |
| evaluation-real-drivers.test.ts | 3 |
| evaluation-b05.test.ts | 5 |

合计为本支线 **40 项不同定向测试通过**，不等于全仓库回归通过。第一批已通过的 seed／objection／boundary／continuity／history 组没有无依据重复执行。定向 `git diff --check` 无输出。

## 3. 证据强度与保留限制

合成 proof 用例明确标注为离线审计样本。它们覆盖完整暂定采用、held 决定、错 hash／候选版本／范围、缺核心回执、未装入 manifest、改动可见答复、人格管理回执冒充使用、新写 v1 adopted、缺失来源、未知效果缺局限、来源撤回／元数据变化，以及采用后撤下仍须追溯历史资格。人工构造这些测试图不算真实试行成绩。

为防止测试图与生产接口一致性不足，新增了一条实际 **Core＋Memory＋DSH** 对照：第一 Run 通过生产服务观察 synthetic 材料、提出候选并选择 trial；关闭后捕获基线；第二 Run 实际装入试行并保存可见结果；第三 Run 引用真实 `status.trialOutcomes` 完成 `reviewAdoption` 和 `publish`，再关闭后运行审计。该链通过，采用仍为 tentative，反证未取得和覆盖局限保留。

上述对照的模型是脚本后端，账本为 offline，费用为零。两个受管报告均明确 `realModel:false`、`realPlatform:false`、`serverAccess:false`。真实 DSH 持久链不等于真实模型行为、现实平台效果或完整语义验收。

规则没有通过 B02／B07 例外、kind 白名单或“暂定”措辞放宽。允许的是证据链合格的真实状态变化；来源不可核、无资格采用和必要阻断缺失仍失败。原第 52 项 B02 与既有 B07 failed 不被改判，新结果只能属于重新冻结的新 candidate。

## 4. 后续预飞条件

先由主代理完成 R3 剩余 SQL 测试修正及定向复验，再按依赖顺序提交生产实现与 R4。新 candidate 须包含新的证明模块、工具名单和 synthetic／legacy 种子协议，重新校准后才可进入全矩阵；旧候选校准不能复用。

付费预飞沿用唯一原账本，读取追加授权、实际余额与原时钟。原 config 60 元保留；本轮授权的 effective 累计上限为 **97.894922 元**，既定 6 小时执行上限和首次调用后 48 小时不变。确认关闭 profile、唯一执行器及费用未知项均满足准入条件后再由主代理启动；本支线没有新增模型费用。

语义交叉复核仍须明确标记为代理／AI 评阅，检查事实覆盖、必要内容、禁忌和无依据经历；不能把本记录或程序通过宣称为人工验收通过。服务器阶段另按最新现状保护真实记忆、账号和新增数据。
