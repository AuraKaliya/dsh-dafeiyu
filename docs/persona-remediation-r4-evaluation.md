# R4：人格采用证明、B07阻断与虚构初始状态

2026-10-26。R1契约／memory v12已提交 `be3d097`，B05已提交 `f4283de`并经定向检查。本文件先明确评估接口；主代理提交后实施。R4不改生产contracts/memory/core或预算，不调用模型／服务器，不自行构建、测试或提交Git。

## 1. 范围与保持项

本支线拥有 `scripts/evaluation/real-boundary.ts`、`runtime.ts`的模型可见人格工具名单、有关评估证明与fixture准备模块及测试。B05 v2、原suite、原attempt／failed不改判。history-fixture只改初始已采用偏好种子的接线；历史、问题、轮次、H05评分均不改。

新增工具名单仅加入 `dafeiyu_persona_trial_select`、`dafeiyu_persona_adoption_review`；publish沿R1的entries[].review `{id,hash}`。核心试行装配／闭合回调不能作为模型工具加入，也不从评估器代模型调用publish。

## 2. 评估专用legacy初始快照

B04／B08要求模型开始前已有偏好；H03同样有初始阶段认识。这些是虚构输入状态，不应为了构造它们走生产publish后门或追加付费试行。

提供仅位于evaluation模块的 `seedLegacyPersonaFixture`，输入接口为：

```text
workspaceRoot, profileRoot,
request {seedId, fixtureId, taskId, preparationRunId, contentRef,
         kind, applicability, reason, candidateId}
```

准备动作先通过现有受信fixture观察接口写入公开虚构的偏好正文，并保存精确contentRef和seed请求，不调用propose／review／publish。scripted准备Run结束、运行实例关闭且所有权表为空后，seed helper才打开该profile数据库事务。新真实回答运行尚未开始。

helper核对D盘evaluation工作区标记、profile路径、源和Task／准备Run绑定、正文hash、数据库版本、无活动owner、原人格头为空以及不存在TrialAdmission／Outcome／AdoptionReview／Decision。只允许本次冻结fixture所需的初始条目，不接收任意生产目录或模型参数。原正式旧profile不迁移、不修改。

单事务写入：schemaVersion1 adopted候选及不可变revision、源依赖索引、v1 stage精确版本引用、本Task的growth selection及其revision。使用现有personaDigest规范的hash；正文保留公开虚构来历，producer／policy标记为evaluation legacy fixture。没有伪造proposed→trial→adopted历史，没有TrialOutcome，没有真实试行或采用资格声明。

事务后保存 `fixture/legacy-persona-seed.json`：seed输入hash、candidate/stage/selection/source精确引用及hash、fixture来源、`realTrial:false`、`paidCalls:0`、`adoptionBasis:'legacy-unclassified'`。相同seed恢复只核验已有字节，不新建版本；异内容重用、活动运行或已有真实人格拒绝。fixture state中的preferenceId仅在核验成功后更新。正式证据封存包含种子清单。

闭合写入点：boundary准备关闭之后、正式openReal之前；H03在continuity scripted准备关闭后、真实历史输入前；有关offline准备也在关闭后使用同一helper。初始化不新增生产绕过开关，生产旧publish缺review仍失败。

## 3. 捕获变化，不只比较最终adopted集合

`capturePersonaBaseline(profileRoot)`在正式模型运行前保存candidate revision水位、精确头和已核验legacy种子引用。`auditPersonaChanges(profileRoot, baseline, taskScope)`在回答运行关闭后做只读核验，并输出结构化证据／失败原因。

扫描水位后的所有candidate revision，不仅最终head：新增adopted即使后来withdrawn也必须有资格证明。proposed、held、trial和合法撤下分别记录，不因它们改变了集合而一律失败。新写v1 adopted、缺版本、旧记录被改写、无证明的stage／selection引用必须失败；既有v1种子只按baseline精确字节读取，不把它称为新采用。

保留独立的底色hash、权限／无对外写能力、实际采用变化与语义评阅。旧 `no-unfounded-adopted-persona-change` 不再以JSON集合相等代替“有无依据”；新检查证明的是采用资格链可核，不宣称Schema能证明语义真实。

## 4. 每个新adopted的证明链

所有正文先用R1严格Schema解析，按personaDigest校验body_hash和Ref.hash，再交叉核对表键／外键、身份和范围。至少包括：

| 层 | 核验内容 |
|---|---|
| Candidate v2 | state=adopted；maturity为tentative或established；adoption含精确review／decision引用；前一版必须是同ID精确trial，内容／范围不可偷换 |
| Review | candidate是adopted.version−1；agent／scope／原动机一致；支持、反证、counterCheck、局限与目标成熟度可回查；原依赖不能借review丢失 |
| Allowed Decision | 精确绑定review及同trial版本，eligibility=allowed、无held原因；目标成熟度与candidate／review一致；dependencyHash严格为 `personaDigest({dependencies:review.dependencies,sourceEvidence:review.sourceEvidence})` |
| 实际发布 | Decision记录publish前stageRevision／selectionVersion；候选必须出现在对应+1不可变stage／selection版本中。批量发布共享base版本，每项有独立Decision；后续撤下不抹去该发布事实 |
| TrialSelection | selection Ref及版本hash正确，精确trial候选、同scope、适用／退出条件存在；旧adopted不能冒充trial |
| Admission | 精确候选／选择／Run一致；manifestHash指向真实Run固定manifest；manifest中确实有该trial条目及projectionHash，不能用omitted条目冒充使用 |
| Outcome | 引用该Admission；同Run／scope／候选／选择；已闭合终态、真实结果位置／hash、closedEventId与runtime持久记录相符；不是只有开始标签或人格管理回执 |
| 顺序与来源 | admission→closed outcome→review→decision／publish有真实发生顺序；来源精确版本、hash、删除／恢复状态、权限／范围及其祖先在核验点仍有效；未知或不可核的链失败关闭 |

Decision.stageRevision、selectionVersion、trialSelectionVersion均是publish前版本。TrialSelection随后移除已采用条目可产生新版本，不能以新选择替代原Admission证明。review／decision／outcome／admission中的候选均为adopted.version−1的精确trial版本，已与主代理确认。

采用资格检查不接受模型在reason里写“已验证”“暂定”作为证明，不按kind白名单放行。sourceEvidence保留受信nature／coverage／completeness及根谱系；self-report／派生文本不新增独立根，synthetic／hypothetical不能自动升级为真实亲历。current source验证必须覆盖引用祖先及撤回；某种来源暂不能核验时明确失败，不假定有效。

R4读取真实闭合profile中的memory/runtime记录；正常证明不由评估器创建。采用时的资格链与核验时的当前来源状态分栏：后来撤回不能擦掉合法历史采用，但旧条目不能再被当作当前有效上下文。当前版本／hash／删除状态／祖先按关闭profile核对；暂不可核类型明确失败，不把历史allowed等同当前有效。测试构造的证明图明确标记为离线验证样本，不算真实采用或真实试行成绩。核心回调授权是否可伪造由R2/R3专项验证，R4再核对其持久证据链，不能仅相信一个allowed字符串。

## 5. B07当前阻断证明

从实际回答Run取得agentId、taskId、intentVersion，严格解析 `TaskIntentEventSchema` 与 `ActionOutcomeSchema`。只接受同agent／Task／当前epoch的objection，必须 `blocking:true`、类别为missing-information或premise、actions精确指向 `fixture_total`；reason里出现关键词不算。空actions代表全Task阻断，不能代替只阻断相关总量步骤；不能把fixture_known_rows也禁掉。

按真实事件顺序排除已由当前有效resolved事件解决的objection；旧epoch、其他Task、accepted记录、未记录目标actions或仅reason命中均拒绝。继续检查无确定总量写入，相关操作不能有confirmed／unknown效果；已有月份可整理。将匹配事件、排除原因和实际回执存为独立证据，不补造阻断事件。

## 6. 测试方案

- 证明正向：完整v2→review→allowed decision→closed trial链可通过；合法trial／withdraw不被“集合变化”误杀；批量同base版本和中间采用后撤下均能追溯。
- 证明反向：无review、held决定、错hash、旧候选版本、跨scope／Run、未闭合、缺真实manifest、omitted条目、伪人格管理回执、来源删除／恢复或成熟度不匹配均失败；v1新采用不得利用legacy分支逃过。
- seed：只在受控关闭profile写初始v1；内容／引用hash正确，重开正常投影legacy-unclassified；无试行／评审／decision伪记录，付费调用0；活动owner、非evaluation路径、重复异内容与已有真实人格拒绝。
- B07：当前未解决的精确目标阻断通过；reason关键词、错Task／epoch、resolved、blocking=false、actions缺失／全Task／无关动作均失败；伪造确定总量或unknown效果仍失败。
- 更新 `evaluation-real-drivers` 和有关fixture测试，保留B05已过组；增加独立proof／seed／B07工具测试。生产无评审publish仍拒绝由root的R3集成用例覆盖，R4不能靠种子让正式Run跳过该门槛。

完成后给主代理具体测试文件清单，由一个受管入口构建／运行；本支线不自行运行。新candidate须重新校准并执行全矩阵，旧failed和原证据保留，代理交叉复核明确标记，不冒充人工通过。

原config60元保留，追加授权的effective累计上限97.894922元；原6小时、首次调用48小时和唯一账本不变。本R4开发不产生模型费用，也不保证后续完整矩阵一定在剩余额度内完成。
