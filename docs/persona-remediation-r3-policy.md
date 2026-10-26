# R3 采用资格纯策略规范

2026-10-26，待主代理提交/确认后编码。只实现新 `packages/memory/src/persona-adoption-policy.ts` 与 `tests/persona-adoption-policy.test.ts`；Store/Service/Core/Contracts/maintenance接线由主代理负责。本规范不重评旧failed，不恢复真实调用。

## API与职责边界

```typescript
export interface PersonaAdoptionTrialEvidence {
  readonly admission: PersonaTrialAdmission;
  readonly outcome: PersonaTrialOutcome;
}
export interface PersonaAdoptionPolicyInput {
  readonly candidate: PersonaCandidate;
  readonly review: PersonaAdoptionReview;
  readonly trials: readonly PersonaAdoptionTrialEvidence[];
  readonly sourceEvidence: readonly PersonaSourceEvidence[];
  readonly originalMotivation: Motivation;
  readonly scope: ExecutionScope;
}
export interface PersonaAdoptionPolicyResult {
  readonly eligibility: 'allowed' | 'held';
  readonly reasons: readonly PersonaAdoptionReasonCode[];
}
export function evaluatePersonaAdoption(input: PersonaAdoptionPolicyInput): PersonaAdoptionPolicyResult;
// 确定性SHA256策略身份，供不可变Review/Decision绑定；变更规则须变更版本。
export const PERSONA_ADOPTION_POLICY_VERSION: string;
```

函数无数据库、文件、网络、时钟或模型调用，不修改输入，不采纳评分/成熟度概率，不接受默认true的verified布尔。运行中的候选和数据必须先通过共同写入边界的Schema、精确引用/hash、当前版本/状态、作用域/授权、来源有效性及core活证书检查；这些职责不因纯函数返回allowed而取消。

共同边界负责确认Outcome确实来自被装配的trial、结果在复核前已持久结束、result.textHash对应合法的真实可见输出；不得把伪造的结构正确对象送来假称“已核验”。本函数再做不依赖DB的身份/范围/时间一致性检查以发现接线错误，不重新认证签发者，也不把sourceEvidence缺失默认成真实/完整。

`originalMotivation`是被复核候选的受信原始动机，不是本次“采用评审”任务的maintenance动机。Review及候选保留该动机；不得把explicit-task换名为self-exploration。源引用可以通过合法授权来自其他范围；不得简单要求每个source.scopeKey等于本scope而破坏合法选材。

## 基础门槛

| 检查 | held原因 |
|---|---|
| candidate不是当前trial，或review/admission/outcome候选ID及版本不一致 | candidate-stale |
| candidate/review/admission/outcome所属scope与受信scope不一致 | scope-mismatch |
| review.conclusionScope与candidate.applicability不逐字相同 | scope-mismatch |
| review或candidate的motivation.kind与originalMotivation.kind不同 | motivation-mismatch |
| review引用的Outcome没有完整传入，或没有任何试行链 | trial-evidence-missing |
| 所有引用结果均无completed Run可见结果，或结果关闭时间晚于review.createdAt | trial-not-closed |
| Admission/Outcome的runId、selection、admission引用不对应；admittedAt晚于closedAt | trial-not-used |

范围采用精确一致比较，不做模型语义等价判断。若需要扩大或改写适用条件，创建新候选/新版本并重新试行，不能通过review.reason或conclusionScope偷偷改写旧内容。发布时仍保留候选正文、applicability、原动机和实际依赖，review只增加采用依据与拟采用成熟度。

身份、引用和发生顺序上的错误不能靠另一个“正常”结果平均掉。合法但failed/cancelled/interrupted的Outcome仍保留，它不计作成功的可见试行；存在一份合法completed试行时，其他失败可作为已保留局限/反例参与暂定采用。无固定次数或天数，时间戳相等不自动拒绝，真正先后仍由core持久事件和引用链证明。

## 哪些结果证明使用

最低可接受使用证据是：实际Admission后，一个已闭合Run具有真实的非空可见结果。它可以是一次正常对话中的表达/选择，**不要求调用工具或发生外部写入**。completed只证明Run闭合，不代表所有操作成功或现实效果得到验证。

以下不能单独算使用：只有propose/review/publish/selection的成功回执、尚未结束的输出、没有Admission的“我已经试行”，以及原候选自述的原样回放。策略检查结果hash：空文本hash、与candidate.contentRef的hash相同、与已知self-report来源正文hash相同，或等于本Run人格管理操作的outcomeHash，均不作为有效使用。若剩余没有合格可见结果，返回trial-not-used。

人格管理动作按能力名类别识别（`dafeiyu_persona_*`及`dafeiyu_memory_persona_candidate`），不按B02或任何样本ID判断。管理操作的effects=confirmed本身不增加证明力；同一Run也有真正对话结果时，不因调用过status工具而一律拒绝。

hash只发现原样回放，不能证明不同hash就表示语义上有新行为。对改写自述、空泛回应及实际选择是否充分的判断仍需语义评阅；程序不得宣称因此解决了幻觉。root必须核验可见结果而非仅相信hash字符串。

## 来源、局限与反证

- 按精确PersonaSourceRef匹配 `sourceEvidence`；候选和review的支持/反证、候选contentRef均需有受信描述。缺描述或同一精确引用出现冲突描述返回coverage-insufficient。完全相同的重复描述去重，不“挑最有利的一份”。
- 支持的root key只去重，派生/自述不新增独立票。若同一root出现互相矛盾的nature，保持保守并返回coverage-insufficient；从不根据数量计算分数或要求至少两个根。
- candidate.counters中的精确引用必须继续出现在review.counters中；丢弃已知反证或found却无反证引用，返回counter-evidence-unresolved。已有反证本身不自动禁止采用；保留它并说明限制，可以形成有条件的认识。
- 新增checked-none表示确实检查过指定资料、在该覆盖内未找到反证。公开CounterCheckInput的checkedSources是已曝光source键字符串数组（1..32）；持久CounterCheck的checkedSources是精确PersonaSourceRef数组（1..32）。root解析并继承这些来源及描述，核验实际可用/已结束的检查依据，不能把一句reason当成检查证明。它不等于“世界不存在反例”，也不允许丢弃已有counter引用。
- not-obtained/unknown明确表示反证证据未取得/未知，不能转换为“已经检查不存在”。tentative允许这种状态，但review必须有非空limitations，reason继续保留未知说明。
- synthetic/hypothetical/self-report/derived/unknown来源或partial/unknown覆盖可支持提出、试行及有条件的tentative采用；这不是已验证亲历。其存在、Outcome的gaps、未完成结果、unknown操作效果/覆盖都要求非空limitations。缺局限返回coverage-insufficient。
- 本函数不修改来源、填充缺口、自动剔除不利Outcome，也不把“有来源”提升为“该主张已被独立证实”。

## 动机与成熟度

| 目标 | 资格规则 |
|---|---|
| interest/preference/habit的采用 | 原始动机仅允许self-exploration或conversation-invitation；explicit-task/mixed/maintenance/unknown返回motivation-mismatch，统一maintenance现有边界。该规则不禁止提出或试行。 |
| view/value-application的tentative采用 | 可以来自explicit-task中的限定反思；须满足使用、范围、来源及局限条件，不能因此改写成自主探索。 |
| relationship的tentative采用 | 仍须精确对象/范围与合法来源；虚构或未知只作限定认识，不自动成为真实稳定关系。 |
| 任意established目标 | 必须有合格试行；全部被用于支撑成熟目标的支持及反证描述均为observed、complete，根nature也为observed；至少有一份实际支持，不能只凭candidate自述。否则maturity-unsupported/coverage-insufficient。 |
| established的反证检查 | found须保留已处理反证的合法来源与公开理由；checked-none须有非空checkedSources且其受信描述为observed/complete、根也为observed。两者都不要求另一个独立根；not-obtained/unknown返回counter-evidence-unresolved。是否充分回应反证仍属语义评阅。 |
| established且引用Outcome有gaps、未完成结果或unknown状态/效果/覆盖 | coverage-insufficient；事实未知不能成为“已验证长期效果”。已知failed/none并不直接等于未知，但其意义仍需有据说明。 |
| established的habit/relationship | 至少一份observed、complete支持还必须是引用试行Outcome.sources中的精确来源，不能仅凭先前自述或一次闭合文字的存在断言长期行为/关系。允许同一个根，不要求外部写入或固定次数。 |

“至少一份支持/一次可核试行”是存在性要求，不是机械累计门槛；一次有分量的经历即可符合。established表示在明确范围内具备较充分可追溯依据，仍可修订，不意味着永久真实。上述条件只检查可核资格，来源是否真正支撑概括、反证是否被充分回应仍是语义判断。

## 输出与接线

全部不满足项去重后按固定顺序返回：candidate-stale、scope-mismatch、motivation-mismatch、trial-evidence-missing、trial-not-closed、trial-not-used、counter-evidence-unresolved、coverage-insufficient、maturity-unsupported。无原因才allowed。来源撤回/引用hash失效由root直接拒绝，不在缺少现状证据时假报source-stale。
root把结果连同策略hash、review引用和当前版本写入Decision；allowed不是可长期缓存的授权，publish提交前仍需重验来源与依赖。失败publish不插入held决定或更改stage；持久held评审须走明确的评审写操作。兼容旧Run已经合法装配的trial后来变为adopted是Store职责，不由此函数放宽当前新采用候选必须处于trial的要求。

## 编码与验证范围

除主代理明确追加授权的CounterCheck小范围扩展外，仅新模块与专属测试。Contracts增加PersonaCounterCheckInputSchema，将checked-none的公开键与持久精确引用分开；同步R1契约专项测试及文档，不新增宽泛开关，不进行DB状态修复。策略版本用稳定规则声明的personaDigest确定，规则变化显式升级。
专属测试覆盖：单根合格暂定采用；无工具的闭合对话；缺Admission/缺Outcome；未结束及时间逆序；原样自述/管理回执；scope逐字不符；原动机被改写；三类兴趣动机限制；synthetic/partial/unknown的限制；反证丢弃与未知；一个observed根的合法established（found及checked-none分别有正例）；checked-none缺引用、伪自述或覆盖不足不可成熟；仅旧自述不能证明稳定habit/relationship；同根重复不增资格；描述冲突；输入不变及确定性输出。
采用资格测试通过只证明这些程序条件，不能称人格语义或真实模型修复已验收。本分支不执行构建/测试/Git/付费模型/服务器，由主代理提交规范后通知编码并统一运行相关测试。
