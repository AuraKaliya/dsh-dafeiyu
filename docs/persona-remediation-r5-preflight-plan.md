# R5 预飞方案：显式协议升级与新候选全量重验

2026-10-26。本方案承接 `docs/persona-remediation-r4-evaluation.md` 和 `docs/persona-remediation-r4-check.md`，先形成可审阅文档，由主代理提交后再实施。此阶段只做协议、证据和运行准入准备，不调用付费模型或服务器。

## 1. 显式使用 7c-real-2

现有 `realProtocolHash` 的 `7c-real-1` 只包含原历史、压缩、准备流程等约束。R4 已改变采用资格的核验方式、B07 阻断证明及初始偏好的分类；虽然 runtimeHash 的变化已能阻止候选字节复用，protocolHash 仍应明确区分这些语义规则。

在 `scripts/evaluation/real-candidate.ts` 将协议版本升为 `7c-real-2`，保留原 suite／manifest／foundation／authorization、压缩参数、历史目标、轮次及重启位置等绑定，并增加以下字段：

| 字段 | 固定绑定 |
|---|---|
| adoptionPolicy | 生产资格策略 `PERSONA_ADOPTION_POLICY_VERSION` 的实际 hash |
| trialProtocol | 试行记录协议 `PERSONA_ADOPTION_POLICY` 的实际 hash |
| personaProof | `closed-native-chain-v1`：精确 v2／review／allowed decision／真实装入与闭合回执／当前来源保护 |
| legacyFixture | `closed-profile-synthetic-legacy-v1`：关闭受管 profile 的虚构 legacy v1 初始快照；不声明真实试行 |
| b07 | `current-task-epoch-unresolved-target-v1`：当前 Task／epoch 的未解决精确目标阻断 |
| b05.protocol | 已有 `B05_PROTOCOL`，即 `b05-message-v2` |
| b05.materialHash | `sha256(B05_MATERIAL)`，明确绑定两条公开虚构事实及一致引文的实际输入 |

两个策略值从实际生产导出读取，不手抄 hash；B05 协议和材料从现有模块读取。不得将模型传入值作为这些固定资格参数。candidate 文件和契约的 `schemaVersion` 保持 1，不更改原数据库、suite 或 manifest 的历史版本。

## 2. 原证据保留，禁止跨协议复用

旧 candidate、原校准记录、正式前 52 项及其重试／恢复 attempt、原失败和评分全部保留。不得改写旧 candidate 为新协议，也不得把旧材料重签成新运行。

新候选必须冻结新的 runtimeHash 和 protocolHash。即使构造出相同 runtime identity，`7c-real-1` 的 candidate 也不能因其他字段相同而被 `freezeRealCandidate` 选中。新 candidate 生成独立文件，旧文件字节保持原样。

旧校准标记与旧 scope compatibility certificate 不能用于新候选；不得以“B05 已过”“某个 H 场景没改”或已有局部兼容证书抵扣这次正式矩阵。新协议完成校准后，**162 项正式用例全部重新执行**，仍按冻结 manifest 的原顺序、同组历史隔离及预算准入规则进行。校准用例单独记账，不算进 162 项完成数。

结果只表示各自实际运行的 candidate。旧失败不因开发修复或离线测试通过而改判；新结果也不能替代或掩盖原第 52 项 B02 和既有 B07 等失败证据。

## 3. 预算与时钟不重置

唯一原账本仍为 `.runtime/acceptance/7c-20261026`，不重建、不清零、不建立并行付费账本。原 config 的 60 元保留；已授权的增额使 effective 累计上限为 **97.894922 元**，增额后本轮可用余额以 **50 元**为起点。这是剩余额度授权，不能再重复追加 50 元。

原机器累计 6 小时执行上限、首次实际调用后 48 小时窗口及其已用时间／起算点全部保留。提交新代码、冻结新 candidate 或重新校准都不重置时钟。每次准入读取同一账本的实际余额、未知费用、活动区间与剩余时限；本方案不保证 162 项及校准一定能在余量内完成，也不自动提高任一限额。

真实调用仍由一个协调者／执行器持有唯一 lease。多代理用于独立审查、离线结果监督和语义交叉复核；本次协议升级不开放多个付费执行器，也不隐含真实模型并发改造。

## 4. 当前检查与实施次序

本方案创建时，Host／维护相关定向组正在由主代理通过统一受管入口执行。共享构建由主代理协调，源码在其编译窗口保持暂停；本支线不另起构建、测试、模型或服务器进程。

R4 检查记录已保存，准确区分 40 项不同定向检查通过、实际 Core／Memory／DSH 生成的证明链与脚本模型。真实 DSH 持久链仍是 offline、零付费、零平台测试，不是实际模型语义验收。各批非 R4 失败及其后续修复按主代理记录单独闭合，不能将整批失败报告写成整批通过。

实施顺序：

1. 主代理先提交本方案和 R4 检查记录，按依赖顺序闭合 R3／R4 与当前 Host／维护相关检查。
2. 收到主代理实施通知后，仅修改 `real-candidate.ts` 及 campaign／scope 专项测试，补足显式协议描述和兼容边界；不改正式旧账本或旧证据。
3. 由主代理统一运行最小相关检查并保存报告，提交协议实现及测试；保留 `docs/memory-phase-1.md` 的既有未提交修改。
4. 检查实际源码提交状态和构建产物一致性，执行 clean source／runtime identity 检查，冻结新 candidate。文档变化可沿现有规则复用相同字节候选，源码或协议变化必须重新冻结。
5. 读取原账本已应用的增额授权、实际余额、原时钟及唯一执行器状态。只有 clean identity 已冻结、相关功能阻断已闭合且准入仍满足时，才由主代理进入新候选校准；当前方案阶段尚不付费。
6. 校准完成且费用闭合后进入 162 项新矩阵。出现功能失败、未知费用或预算／时限阻断时按原规则停下并保留证据，不以重复抽样、改评分或旧证书复用绕过。

## 5. 最小专项验证

- `tests/tooling/evaluation-real-campaign.test.ts`：保留现有文档提交复用、runtime 变化新建候选、校准门槛、传输后端分类及预算不重置检查；新增新协议固定字段／两策略 hash／B05 材料 hash 绑定，以及相同 runtime identity 下旧协议候选仍不得复用的检查。
- `tests/tooling/evaluation-scope-compatibility.test.ts`：保留 protocolHash 变化拒绝兼容证书与结果复用的断言，并确认新协议不接受旧 scope 证书。
- 验证旧候选文件字节未改、新候选仍需自己对应的校准记录，原账本额度和首次调用时钟没有被候选升级重置。所有这些专项检查使用受管离线数据，不发真实模型调用。

完成预飞不等于通过真实矩阵，更不等于可以直接部署。后续语义复核明确标记为代理／AI 评阅，逐项检查事实、mandatory／forbidden、无依据经历和任务边界；服务器阶段仍须先核对最新实际状态并保护新增真实记忆与账号。

## 6. 必要入口补充：显式不复用旧 scope

协议专项实施时确认，现有 `continueRealMatrix` 会无条件读取 `evaluation/phase7c/scope-compatibility.v1.json`。旧证书属于原候选，`7c-real-2` 应拒绝它；但直接删除证书或修改证书会损坏历史语义。另一方面，基础批次入口的 `--retry` 会将整批阶段设为 retest，不能用它把这次新候选的 162 项正式矩阵全部转记到重测份额。

因此增加显式 matrix 参数 `--no-scope-reuse`。本节先由主代理提交，再实施以下最小变更；当前已完成的协议 11 项专项检查由主代理先统一执行，不在其编译窗口改动控制器源码。

- `scripts/acceptance-matrix.ts`：为 `continueRealMatrix` 增加可选的 `scopeReuse` 设置，默认 true，保持原调用形式和旧行为兼容。false 时不加载旧 scope 作为准入依据，必须核验当前新 candidate 自己的校准；不接收兼容历史 baseline，不从旧 candidate 借用通过结果。
- 计划函数同步接收这一选择。false 时只对当前 candidate 的 `needs-human-review` 项执行 skip-pass；旧 candidate 的通过／失败均不作为当前完成依据。新候选自身出现 failed／blocked／interrupted 等未通过结果时停止检查，不使用任何旧 triage 或 retain-failure 分支越过它。即使传入 scope 或 triage 对象，也不能在该模式恢复兼容放行。
- 阶段仍显式使用 **formal**；既有 attempt 需要新的 ordinal 时，单项的 `retry` 仅表示保留旧 attempt 后新建记录，不改变活动执行区间的 formal 费用归属。原唯一账本、lease、时钟、费用未知保护和失败停止规则不变。
- 冻结 manifest 的顺序、每批 18 项、此前批次全部完成门槛不变。此前用例只有当前 candidate 已通过才能满足门槛；旧 52 项不能抵扣。每项实际执行仍通过原 driver 创建独立 profile，H 组仅共享当前 candidate 自己产生的合法基线，不引入旧候选历史。
- `scripts/continue-integrated-matrix.mjs`：解析唯一 1—9 批号及可选且不重复的 `--no-scope-reuse`，将显式设置传入控制器；未知参数、重复 flag 或多个批号仍拒绝。无 flag 时沿用原行为。
- controller 和 batch 记录保存实际 `scopeReuse` 选择及 formal 阶段，使审阅者能够区分旧兼容续跑与新候选全量重验。旧证书与 triage 文件可作为历史控制器材料留存，但在 false 模式不参与准入／跳过判定，不删除、不重签、不改分。

相关验收限定于 matrix continuation 和必要 CLI／scope 专项测试，仍由主代理统一构建执行：

1. 默认模式的已有兼容／保留失败行为保持原测试结果。
2. `--no-scope-reuse` 被 CLI 正确接受，受管测试环境仍在任何真实调用前拒绝；重复 flag、未知 flag 和错误批号拒绝。
3. 无复用模式忽略旧通过、旧失败及旧 scope，按原顺序生成新候选执行计划；只跳过当前候选通过项。
4. 新候选失败即停止，旧 triage 或传入的兼容对象不能掩盖；后一批不能以旧候选记录满足前项门槛。
5. 新建 ordinal 的正式执行仍计入 formal，预算／时钟不重置；controller／batch 明确记录无复用选择。旧证书、旧 attempt／baseline 与原评分保持原字节。

本补充不授权第二个真实执行器或并行模型调用。后续正式矩阵使用显式无复用入口；完成控制器检查、提交和 clean identity 冻结后，才继续原计划中的新候选校准与全部重验。
