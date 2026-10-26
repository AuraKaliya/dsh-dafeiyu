# 7C 剩余预算 50 元的显式授权修订方案

2026-10-26。用户最新明确授权“剩余可用预算 50 元”，继续自主开发与复验。本方案先提交，再实施预算代码；不代表修订已经写入真实账本。由预算代理开发，真实应用和统一测试由主代理执行。

## 金额与不变边界

唯一 campaign 仍为 `.runtime/acceptance/7c-20261026`。停止点 spent=47894922 微元，其中 usage=28715274、9 笔未知费用完整记账=19179648；held=0、未知未处理=0。原 maximum=60000000、remaining=12105078。
新有效累计上限严格为 **47894922 + 50000000 = 97894922 微元**，只增加 **37894922 微元**。不是在原 60 元上再加 50 元，也不把任何已记账未知费用返还。
原 config、metadata、来源授权文件、既有审计事件、attempt、reservation、封存报告及九笔实际费用未知标记全部保留。firstCall=`1792959270580`、expiry=`1793132070580`、active=`7438303 ms` 不变；原累计 6 小时／首次调用后 48 小时不延长。模型、单价、输出上限、单次全额预留与单在途限制不变。

## 新授权与原子事件

新增 `evaluation/phase7c/budget-amendment.v1.json`，严格校验授权 ID、原授权 ID/hash、唯一 campaign、停止点费用构成／九笔计数／无占用、原时钟、原上限、新可用额、新累计上限与差额；记录明确用户授权、不自动增额，继续沿用未知费用全额永久记账政策。原 `authorization.json` 和 `bounded-cost-authorization.v1.json` 不改写。
ledger 新增显式 `applyBudgetAmendment` 命令；一个事务追加不可变 `budget.authorization-amended` 事件及新的 `budget.allocated` 事件，不更新原 config 或 clock、不增加数据库可变“余额”副本。修订事件包含完整公开授权决策、授权文件 hash、停止点及新份额，便于重开和报表复算。
首次应用必须在无执行中时钟、无 running attempt、无 reserved／held／未处理 unknown 的状态，且停止点的 spent、usage、上界计入、九笔计数、累计时钟、首调用与到期逐项精确匹配。阶段已用额不得下降。不能对新建空账本套用本修订。
同一授权 ID、文件 hash 和内容重复提交，返回已有决策，不重新增加上限或重置阶段份额；即使后来已有新支出或重新分配也不能重复应用。相同 ID 内容冲突、第二个修订、停点变化、原授权不符均拒绝。并发申请由原账本事务与执行 lease 串行化。

## 有效上限、阶段份额与历史兼容

原 `config.budget.maximumMicroCny=60000000` 及原 authorizationHash 保持冻结含义。无修订事件时，行为与旧版相同；有合法事件时，`budget.maximum`、`remaining`、阶段分配总额校验和请求前预留使用有效上限 97894922。报表单列修订链／原上限与授权 hash，不把旧 60 元事件改解释成新授权。
初次修订将新增可用 50 元分为校准 10 元、正式 30 元、复测 10 元；累加既有各阶段实际占用，得到以下完整累计份额：

| 阶段 | 已用微元 | 新可用微元 | 修订后累计份额微元 |
|---|---:|---:|---:|
| 校准 | 23343152 | 10000000 | 33343152 |
| 正式 | 15875920 | 30000000 | 45875920 |
| 复测 | 8675850 | 10000000 | 18675850 |
| 合计 | 47894922 | 50000000 | 97894922 |

后续只可在有效总额内显式调配，不能减少任一阶段已经发生的费用。CLI `--allocate` 支持最多六位小数的元输入，直接转换整数微元，不能以浮点乘法或原“整数相加等于60”规则处理新上限。
原 `RealAuthorizationSchema` 继续严格固定原 60 元、model、时间与原 hash；不以改写旧文件解锁。入口除了保留原 config/hash 校验，还核验已应用修订的内容及文件 hash；仅存在新授权文件而未显式应用，不自动增额。工作区打开／真实运行边界识别修订，matrix/retry 的原 config 检查不需要变为新金额。
未知费用工具保留原单次上界算法和原补充授权 hash。旧文件中的 60000000 应核对原 config 上限，不再错误地要求当前有效上限等于60元；已应用修订需经过共同授权校验。之后每笔合格 unknown 仍按完整 reservation 计入并保持 actualFee unknown。
本次标准单次预留仍为 2131072 微元；余额不足以覆盖该请求时照常硬停，不能因新预算而降低预留。时间到限和原到期检查独立执行，新增金额不能重置或绕过时间限制。

## CLI、所有权与实施边界

新增显式 `--amend-budget`，只读取已提交的新授权文件，在干净版本和现有执行 lease 下应用上述事务，输出修订决策、有效预算、阶段份额及原时钟，modelCalls=0。status/report 展示修订信息。参数、帮助文字和错误码同步更新，不把该命令并入 prepare/calibrate 的自动路径。
预算代理拥有：`scripts/evaluation/ledger.ts`、新增 `budget-amendment.ts`、`bounded-cost.ts`、`workspace.ts` 的授权核验段、`real-runtime.ts`／`real-execution.ts` 的预算入口段、必要的 `authorization.ts` 预算辅助部分、`scripts/run-integrated-real.mjs`、新授权文件、有关 tooling 测试与本方案。其他人格、夹具、评分、matrix/retry、历史材料由各原负责人处理。
预算代理不应用真实修订、不建新 campaign、不运行构建／测试／付费请求、不访问服务器、不读取凭据、不提交 Git、不触碰 `docs/memory-phase-1.md`。本方案与代码经主代理提交和统一验证后，由主代理在原账本执行一次显式修订并封存前后报告。

## 待准备的验证

新增 `tests/tooling/evaluation-budget-amendment.test.ts`，覆盖：旧无事件行为；精确金额与追加审计；重开恢复；重复幂等及冲突／重复增额拒绝；后续支出／调配后重放不重置；运行中、预留中、未知未处理、错误停点／时钟／授权 hash 拒绝；新上限与阶段上限预留；保守 unknown 后续入账；原费用、旧事件、config 和 clock 不变；六位小数精确转换与非法参数；授权文件存在但未应用不增额。
准备原 60 元授权兼容、原 6 小时／48 小时到限和单在途预留回归，拟由主代理统一运行 `evaluation-budget-amendment.test.ts`、`evaluation-real-budget.test.ts`、`evaluation-ledger.test.ts`、`evaluation-bounded-cost.test.ts`（若实际文件名不同按现有对应文件选取），以及受预算入口影响的有关定向 tooling 检查。仅用 D 盘受管临时库，不复制或迁移正式 campaign。验证计划不是已通过结论。
