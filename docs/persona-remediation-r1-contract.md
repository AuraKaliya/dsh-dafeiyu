# R1 人格试行与采用契约草案

2026-10-26。供R1/R2/R3并行编码使用；本文件等待主代理确认，当前尚未修改产品代码、运行构建/测试、迁移正式库或调用模型。以下名字作为拟冻结的导出API。旧v1正文、hash与回执不得重写；新写入入口与旧读取Schema分开。

## 1. 基础类型与版本

- 在 `packages/contracts/src/persona.ts` 导出下述Schema及去掉`Schema`后缀的`z.infer`类型；`index.ts`现有 `export * from './persona.js'` 已覆盖，不引入memory/core反向依赖。
- `PersonaRecordRefSchema = {id: UUID, hash: SHA256}`：不可变记录引用；admission/outcome/review/decision的Ref分别导出命名别名。
- `PersonaTrialSelectionRefSchema = {agentId: string(1..100), scopeKey: string(1..2000), version: positiveInt, hash: SHA256}`。scopeKey使用现有 `personaScope(scope)`，不另发明范围键。
- `PersonaMaturitySchema = tentative | established | legacy-unclassified`；新写目标只允许前两种。`legacy-unclassified`只由读取既有v1采用记录的适配层产生，模型不能请求、迁移不能伪造评审。
- 候选状态仍为proposed/held/trial/adopted/rejected/withdrawn/dormant/superseded。状态、是否当前选用、成熟程度是三个不同概念；试行投影固定tentative。
- 现有 `PersonaCandidateRevisionSchema` 改为显式v1/v2读取联合；原定义另导出 `PersonaCandidateRevisionV1Schema`，新写用 `PersonaCandidateRevisionV2Schema`。v1解析不能注入默认新字段。
- v2沿用v1字段，新增 `maturity: tentative|established`、`adoption: null | {review: PersonaAdoptionReviewRef, decision: PersonaAdoptionDecisionRef}`。proposed/held/trial/rejected必须tentative且adoption=null；adopted/dormant/superseded必须有adoption；withdrawn允许保留原adoption，未采用即撤下者为null。用判别联合或等价严格refinement拒绝非法组合。
- 既有 `PersonaStageSchema` 保持v1：entries仍引用精确候选版本；候选新revision可为v2，无需改写旧stage正文。
- 新 `PersonaAdoptionClassificationSchema`：`{basis:'legacy-unclassified',maturity:'legacy-unclassified'}` 或 `{basis:'reviewed',maturity:'tentative'|'established',review:Ref,decision:Ref}`；仅用于读取/投影分类，不作为写入授权。

## 2. 受信来源描述

`PersonaSourceNatureSchema = observed | synthetic | hypothetical | self-report | derived | unknown`；observed只说明实际取得所标覆盖的内容，不自动证明内容中的所有主张真实。

`PersonaSourceEvidenceSchema`为strict对象：

```text
source: PersonaSourceRef
nature: PersonaSourceNature
coverage: string(1..300)[0..32]
completeness: complete | partial | unknown
roots: { key:string(1..2200), nature:PersonaSourceNature }[0..64]
```

每个root key唯一，保持现有根身份；derived/self-report继承原根性质，不新增独立票。性质由存储/渠道/fixture生产者及受信resolver提供，模型reason不能赋值。旧来源缺少类型化性质时为unknown，不能按正文关键词或`primary`标签猜测真实亲历。此描述与v1 SourceRef分离；不向旧SourceRef或旧execution-source正文补字段，以免改变原hash。

R2/R3的PersonaMaterial携带上述描述（或等价字段），review/outcome保存当时的描述快照并仍按原引用核验现状。coverage不全、性质未知不会一律禁止提出/试行，但不得自动支撑超出覆盖的established认识。没有固定独立根数或浮点质量分。

## 3. TrialSelection：选用试行候选

公开 `PersonaTrialSelectInputSchema`：`{requestId, expectedSelectionVersion:nonnegativeInt, entries:[{candidate:PersonaEntryRef, applicability:string(1..1000), exitConditions:string(1..1000)[1..16]}]}`，entries最多32，空数组明确撤下当前范围试行选择。

持久 `PersonaTrialSelectionSchema`：`{schemaVersion:1, agentId, scope:ExecutionScope, version:positiveInt, entries:上述entry[], runId:UUID, producer:string, createdAt:ISODate, policyVersion:SHA256}`。
身份/scope/runId/producer/版本/时间由受信access与store产生。entry必须为本scope当前精确trial版本、依赖仍有效，不接受adopted冒充trial；同一候选ID只出现一次。此版本独立于growth_selectionVersion和stageRevision。

## 4. 核心签发的装配与完成事实

首版仅支持真实closed Run的可见结果，不定义假可用的operation级证明。先记录实际装配，Run终态及结果持久后再完成；没有trial装配、未结束、只有开始标签均无Outcome。

### Provider回调签名

```typescript
export interface PersonaTrialAuthority {
  /** 必须由core核验对象身份+input指纹；guard函数本身不授予权力。 */
  readonly guard: () => void;
}
// 在既有PersonaProvider上新增可选成员，旧provider仍可编译/读取。
trialAdmitted?(input: PersonaTrialAdmissionInput, authority: PersonaTrialAuthority): readonly PersonaTrialAdmissionRef[];
completeTrial?(input: PersonaTrialCompletionInput, authority: PersonaTrialAuthority): readonly PersonaTrialOutcomeRef[];
```

两个Input都是strict的PlainSchema数据，但绝不注册为模型可调用输入。core用WeakMap登记回调authority对象与该input的规范指纹；memory callback先调用core的 `assertPersonaTrialAuthority(authority,input)`，随后guard核验真实Run/manifest/持久结果。离开回调即撤销；复制对象、序列化、伪造同名guard均不能通过。

`PersonaTrialAdmissionInputSchema`：

```text
schemaVersion:1, agentId, scope:ExecutionScope, runId:UUID,
manifestHash:SHA256, trialSelectionVersion:positiveInt, admittedAt:ISODate,
entries:[{candidate:PersonaEntryRef, selection:PersonaTrialSelectionRef,
          contentRef:PersonaSourceRef, dependencies:PersonaSourceRef[0..64],
          projectionHash:SHA256, sourceEvidence:PersonaSourceEvidence[0..64]}][1..32]
```

core只填写实际成功进入Run请求预算的trial条目，不能把omitted也登记为使用。每个entry封存一份 `PersonaTrialAdmissionSchema`：上述共同字段+单entry，新增store生成的`id`及`policyVersion`；引用返回 `{id,hash}`。精确同Run/候选/选择重放返回同一引用；同身份不同内容拒绝。

`PersonaTrialCompletionInputSchema`：

```text
schemaVersion:1, agentId, scope:ExecutionScope, runId:UUID,
terminal: {state:'completed', result:{sessionId:string, messageSeq:nonnegativeInt,
                                    turnEndSeq:nonnegativeInt, textHash:SHA256}}
        | {state:'failed'|'cancelled'|'interrupted', result:null},
closedAt:ISODate, closedEventId:UUID,
operations:[{id:UUID, action:string, status:'succeeded'|'partial'|'failed'|'cancelled'|'unknown',
             effects:'none'|'confirmed'|'unknown', completeness:'complete'|'partial'|'unknown',
             outcomeHash:SHA256}][0..1000],
sources:PersonaSourceRef[0..64], sourceEvidence:PersonaSourceEvidence[0..64], gaps:string(1..1000)[0..32]
```

首版失败Run不伪造最终文本位置；实际有部分输出仍可作为独立合法source记录，不能冒称completed结果。completed仅证明Run有可见闭合结果，不能推出业务成功或现实效果。每个对应Admission生成不可变 `PersonaTrialOutcomeSchema`：`{schemaVersion:1,id,admission:Ref,candidate:PersonaEntryRef,selection:PersonaTrialSelectionRef,agentId,scope,runId,terminal,closedAt,closedEventId,operations,sources,sourceEvidence,gaps,policyVersion}`；一个admission最多一份Outcome。来源有效性、实际输出hash及终态由core签发，模型不能自报effects或发生顺序。

propose/review/publish自身的成功回执不构成试行成功。R3可把closed但只有人格管理动作、重复自述或缺实际使用依据的Outcome判为held；Outcome是活动事实，并非资格通过票。

## 5. AdoptionReview与Decision

公开 `PersonaAdoptionReviewInputSchema`：`{requestId,candidate:PersonaEntryRef,trialOutcomes:OutcomeRef[1..16],supports:string[0..32],counters:string[0..32],counterCheck,conclusionScope:string(1..1000),targetMaturity:tentative|established,limitations:string(1..1000)[0..32],reason:string(1..2000)}`。supports/counters使用现有已曝光source选择键，不能让模型提交身份/根/性质/动机/实际结果。

`counterCheck`是严格联合：`{status:'found',reason:string(1..1000)}`（解析后counters必须非空）、`{status:'not-obtained'|'unknown',reason:string(1..1000)}`，或`{status:'checked-none',checkedSources:[...],reason:string(1..1000)}`。R3补充：公开`PersonaCounterCheckInputSchema`的checkedSources为已曝光source键字符串数组（1..32），持久`PersonaCounterCheckSchema`为精确PersonaSourceRef数组（1..32）；root解析、继承依赖并验证实际可用/已结束的查证依据。未取得/未知不解释为“不存在反证”，checked-none也只说明在已核查覆盖内未发现，不证明世界没有反例；不能以counters=[]或自述reason冒充查证。

持久 `PersonaAdoptionReviewSchema`：上述内容经解析后将supports/counters换为精确PersonaSourceRef，另加`schemaVersion:1,id,agentId,scope,runId,producer,createdAt,policyVersion,motivation:Motivation,dependencies:PersonaSourceRef[0..64],sourceEvidence:PersonaSourceEvidence[0..64]`。实际选择用已核验trialOutcomes→Admission→manifest链表达，不另信任模型的“实际选择”字段。候选原反证和实际曝光依赖不得借新review悄悄删去。

`PersonaAdoptionDecisionSchema`：`{schemaVersion:1,id,review:Ref,candidate:PersonaEntryRef,agentId,scope,policyVersion,checkedAt,eligibility:'allowed'|'held',reasons:PersonaAdoptionReasonCode[],dependencyHash:SHA256,stageRevision:nonnegativeInt,selectionVersion:nonnegativeInt,trialSelectionVersion:nonnegativeInt,targetMaturity:tentative|established}`。allowed的reasons可为空；held必须非空。reasons首版枚举：`trial-evidence-missing,trial-not-closed,trial-not-used,source-stale,scope-mismatch,candidate-stale,counter-evidence-unresolved,coverage-insufficient,motivation-mismatch,maturity-unsupported,review-required`。

Decision由共享资格策略生成，不是模型提交的授权令牌。review/明确评估写操作可保存held决定并返回confirmed；**失败publish必须保持effects=none，不为拒绝偷偷插入decision/outbox**。允许publish时，在同一原子事务内创建本次allowed Decision、v2 adopted候选revision、stage/selection、幂等回执与outbox。一个review允许有多份不可变Decision，但最终候选只引用本次准确的allowed决定；发布前重新核对当前依赖/作用域/候选/策略，不复用过期许可。

新 `PersonaPublishInputSchema`读旧/新形状：`{requestId,expectedStageVersion,entries:[{id,version,review?:ReviewRef}]}`。缺review的旧形状能解析，但新写路径返回 `PERSONA_ADOPTION_REVIEW_REQUIRED`；旧requestId若已有完全匹配幂等回执，仅返回原回执，不新写或补review。缺trial证据返回 `PERSONA_TRIAL_EVIDENCE_REQUIRED`；过期引用使用 `SOURCE_STALE`/`VERSION_CONFLICT`，资格held使用 `PERSONA_ADOPTION_HELD`。这些错误不改trial/head/stage/selection。

## 6. PreparedPersona与Run manifest兼容

- 现有 `PreparedPersonaEntry` 和 `PreparedPersona.entries`继续只表示adopted；entry新增可选`adoption?:PersonaAdoptionClassification`。缺字段只作为旧provider兼容读取，核心不能将其标成reviewed。
- 新 `PreparedPersonaTrialEntry`保持candidate/contentRef/dependencies/item四个基础字段，另外必须 `projection:'trial',maturity:'tentative',trialSelection:PersonaTrialSelectionRef,exitConditions:string[],sourceEvidence:readonly PersonaSourceEvidence[]`。核心没有独立memory resolver，必须使用实际装配条目携带的受信来源描述封存Admission。
- `PreparedPersona`新增可选 `trialEntries?: readonly PreparedPersonaTrialEntry[]`、`trialSelectionVersion?:number`、`omittedTrials?:number`；v1 provider缺省等价空trial数组/版本0，不能自动从adopted推导trial。
- `PersonaManifestSchema`为v1/v2联合，原定义保留为`PersonaManifestV1Schema`。v2的`schemaVersion=2,assemblyVersion='2'`，保留原基础字段；adopted `entries`每项增加必需adoption分类，另有必需`trialSelectionVersion`、独立`trialEntries`（candidate/contentRef/dependencies/trialSelection/projectionHash，明确projection=trial,maturity=tentative）及`omittedTrials`。
- `PreparedPersonaTrialEntry.item.text`由R2明确标记暂定、适用与退出条件、来源限制、instructionAuthority=false。核心入manifest后才调用trialAdmitted；完成时只用原Run固定清单，不读取后来更新的trial选择替代。
- 新采用的v2候选必须reviewed；旧v1 adopted投影为legacy-unclassified但继续当前scope来源验证。fixture种子保持隔离的原v1/明确fixture来历，无虚构TrialOutcome，生产没有“测试绕过门槛”开关。
- Admission/Outcome中scope、候选、选择和真实Run身份一致性及发生顺序由共享store与core活证书联合核验，不能把Schema形状通过当成资格成立。Publish entries的review可选只服务旧形状的明确错误反馈；所有新成功采用必须有review。

## 7. 主memory v12追加表

导出 `PERSONA_ADOPTION_TABLES`（下列创建顺序）及 `migratePersonaAdoption(db)`；主application_id不变。所有正文用UTF-8 JSON，body_hash采用现有personaDigest的递归排序键规范；hash字段不嵌入自身正文。Ref.hash必须等于该不可变记录body_hash。所有时间/身份/策略/顺序证据来自store或已验证core输入。

| 表 | 主键、外键及必需列 |
|---|---|
| persona_trial_selections | PK(agent_id,scope_key)，version≥0；仅此表为可变头，初始0无正文 |
| persona_trial_selection_revisions | PK(agent_id,scope_key,version>0)，FK(agent_id,scope_key)→trial_selections；body,body_hash |
| persona_trial_selection_entries | PK(agent_id,scope_key,selection_version,candidate_id,candidate_version)；FK前三列→selection_revisions；FK(candidate_id,candidate_version)→persona_candidate_revisions；body,body_hash保存该entry |
| persona_trial_admissions | id PK；agent_id,scope_key,selection_version,candidate_id,candidate_version,run_id,manifest_hash,body,body_hash；FK前述选择/候选五列→selection_entries；UNIQUE(agent_id,scope_key,run_id,candidate_id,candidate_version,selection_version) |
| persona_trial_outcomes | id PK，admission_id NOT NULL UNIQUE FK→admissions(id)；agent_id,scope_key,run_id,body,body_hash；core跨库run引用由活证书核验，不添加伪跨SQLite外键 |
| persona_adoption_reviews | id PK；agent_id,scope_key,candidate_id,candidate_version,run_id,producer,body,body_hash；FK候选两列→candidate_revisions |
| persona_adoption_review_outcomes | PK(review_id,outcome_id)，FK→reviews(id)、outcomes(id)；精确hash保留在review正文并核验 |
| persona_adoption_decisions | id PK，review_id FK→reviews(id)；agent_id,scope_key,candidate_id,candidate_version,eligibility CHECK allowed/held,body,body_hash；FK候选两列→candidate_revisions |
| persona_adoption_dependencies | PK(owner_kind,owner_id,owner_version,source_key)，owner_kind CHECK selection/admission/outcome/review/decision；body,body_hash。沿现有persona_dependencies多态索引风格；owner存在与scope/hash由store核验，不宣称SQL有跨类型owner外键 |

selection owner_id使用规范 `JSON.stringify([agentId,scopeKey])`、owner_version为选择版本；其他owner_id用UUID、owner_version固定1（不可变记录）。source_key复用现有sourceKey(ref)，不对旧表重算。
索引：selection_entries(candidate_id,candidate_version)；admissions(agent_id,scope_key,run_id)；outcomes(agent_id,scope_key,run_id)；reviews(agent_id,scope_key,candidate_id,candidate_version)；decisions(review_id,eligibility)；adoption_dependencies(source_key)。所有新外键ON DELETE RESTRICT，不级联删除历史。
除trial_selections头以外，新表加BEFORE UPDATE/DELETE拒绝触发器；头更新必须version严格递增。review/decision及链接/依赖只追加，撤下用新选择版本及已有候选withdraw流程。新增表不存凭据、内部思考或未授权全文。
继续复用现有persona_requests与persona_outbox保证命令幂等/审计原子性，不另建第二套模型会话/任务循环。core admission/outcome重复由上述UNIQUE和内容hash判幂等，同键异内容拒绝。

## 8. 迁移、版本guard与备份

- v11→v12只建表/索引/触发器并写 `memory_schema_migrations(version=12,migrated_revisions=0,policy='add-persona-trial-adoption-without-reclassifying-legacy-v1')`，最后PRAGMA user_version=12；在MemoryStore既有事务中执行。新库仍经原1→…→11迁移后再到12。
- v12重开核验全部新表及关键列/索引/触发器，不重复插迁移记录；未知未来版本拒绝。任一步失败整个12迁移回滚，库仍为11，不能留下半套表或伪成功版本。
- 不改任何原candidate/stage/revision/request/source/experience正文、hash或行，不扫描重标旧adopted；legacy分类仅在读取投影产生。新版本旧二进制会在最高11 guard处拒绝写入，不能回滚程序后继续写12库。
- 必改guard已查明：store.ts常量/允许版本/迁移注册；migrate-boundaries.ts、observations.ts、task-workspace.ts、task-memory.ts、expression.ts、migrate-execution.ts、migrate-persona.ts、capability-observations.ts、native-expression.ts、migrate-experience.ts的已迁移版本分支增加12。只改迁移行，不触碰业务逻辑。
- host/storage-inspection.ts允许memory12，stage12检查PERSONA_ADOPTION_TABLES，缺任一新表不报supported；从memory/store导出该表常量便于复用。host/migration.ts已按MEMORY_SCHEMA_VERSION取目标，并以sqlite_master枚举全表+SQLite backup备份，新增表不应加入ignoredTables；无需另造备份白名单。
- tests/legacy-execution-fixture.ts先drop新12表（逆序）及迁移记录，再降旧版本；否则旧版夹具残留新表会导致伪迁移冲突。已有memory主版本硬编码11的迁移断言应改用MEMORY_SCHEMA_VERSION或12，不能改其他独立库版本。
- 7C正式账本及95份封存profile不打开MemoryStore、不做迁移；迁移测试使用D盘受管虚构临时库。保护docs/memory-phase-1.md。

## 9. R1实现范围及交接

R1先发布上述contracts类型，随后只新增migrate-persona-adoption.ts，调整迁移注册/guard/host探测及相关迁移测试。persona-store/service、核心装配、source metadata生产及maintenance资格由主代理/R2/R3接入。
新测试文件拟为 `tests/persona-adoption-contract.test.ts` 与 `tests/persona-adoption-migration.test.ts`：严格JSON拒绝模型伪身份/额外评分，v1/v2读兼容与合法组合；v11旧正文/hash/回执逐字不变；空新表与legacy不造证明；外键/不可变/唯一键；幂等重开；故障回滚后可恢复；v12缺表探测失败；未来版本无写入；备份新表完整。
相关旧测试需主代理统一调度：persona-foundation-migration、memory-experience、storage-migration、host-runtime及使用legacy-execution-fixture的迁移用例；R1不自行运行构建/测试/Git，不把尚未运行写成通过。
