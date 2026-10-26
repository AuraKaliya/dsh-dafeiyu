# R5 五项真实校准：独立证据与预算复核

2026-10-26。子代理在执行器已停止后只读核对本批记录、指定五个case、冻结profile及账本；本文是AI证据复核，不是独立人工验收或正式162项通过。没有新增模型/API调用、服务器操作、构建或测试；未读取凭据或模型内部reasoning，session仅按明确的摘要清单／视图事件取证，其他内容不作语义审阅。

## 截点与冻结身份

- 唯一campaign：`.runtime/acceptance/7c-20261026`，未重建或清零。
- 闭合batch：`batches/2f06b2c3-2f52-4689-9d10-97c7cb47f417.json`，开始2026-10-26T11:28:39.465Z，结束11:44:24.560Z；`completed=true`、`runtimeVerified=true`、`error=null`、`humanAccepted=false`。
- codeRevision／controllerHead：`e4c398106c5d2610cc9e7c299cd11530cf8aa9e2`。
- runtimeHash：`2b95a9b7da55ca41bcd27e1b515a45cc994e63aae0af21f95c10189b44e47cf5`。
- 协议：`7c-real-2`；protocolHash：`8d5676c3bc20f03244115594dd879037d8f7ba20cb6f6f12e3bb5728bbcf6a21`。
- candidate文件：`candidates/def560e4594c94ea9753246a66ace0299d84d60a021c63d3f08daad24d8260f0.json`。五份case、batch和calibrated marker引用同一candidate；复算identity hash、candidate key及协议descriptor hash均一致。用于复算的协议／H06／B05／persona policy源文件hash与冻结identity相符。

## 五项实际结果

| 校准项／样本 | attemptId | 程序检查 | 已结算调用 | 费用（元） |
| --- | --- | --- | --- | --- |
| CAL-route／B01 | 04d52642-6cd3-44c4-bc61-624a5dc0f742 | 6/6 | 1 | 0.003114 |
| CAL-boundary／B06 | 2184c10b-0027-4649-bbd4-171542127960 | 12/12 | 3 | 0.078302 |
| CAL-history-full／H06 | 84e1b34e-525b-47fd-94b4-84f1df2f2874 | 13/13 | 17 | 0.863328 |
| CAL-history-compressed／H06 | d83abfc7-414a-4eca-a36a-7aa7c80865c3 | 13/13 | 81 | 0.988884 |
| CAL-history-restarted／H06 | cd2e191a-a1c2-41e7-84c5-541e1cdbdf28 | 14/14 | 81 | 0.927434 |

合计58个程序检查全部为true，五份program.error均为null，最终账本状态均为`needs-human-review`；这是保留的机器状态标签，不表示已有真人验收。五份case均`modelClass=real`、`calibration=true`，回答材料均`semanticAssessment=not-performed`。
CAL-route核对真实原生Run与单模型路由；CAL-boundary核对B06的格式交付、任务目标／epoch、无外部写能力、无无依据采用和当前来源保护。它不是停止时B02或完整B05／B07／H05的重新验收，不能扩写覆盖范围。

## 证据完整性

独立复算五份outcome、全部58份check evidence、32个artifact引用、profile清单及其80个文件的SHA256／长度，共10626470字节，全部匹配；同时检查了路径范围和非符号链接。没有解析session中的模型内部思考。此处复算的是文件字节与清单hash，未将profile内部logicalHash误写成逐库重建后的新结果。
calibrated marker为`calibrated/def560e4594c94ea9753246a66ace0299d84d60a021c63d3f08daad24d8260f0/a659587aeac1146b218ecc5012d58335c1333463995ec789422dab6c4274136f.json`，其五个attempt顺序与本批相符。
关联导出为`reports/3ec9c79f-dfa7-4146-8efc-b922edab546b/index.json`；marker→index→machine／review及全部53个分页面的hash均匹配。报告包含历史100个attempt，不能把这些历史条目当成当前候选新增通过。原audit各行及本批记录hash也一致。

## H06 二代来源与重启

三种条件使用同一已封存基线`baselines/def560e4594c94ea/CAL-H06-1.json`，独立副本logicalHash均为`c2d7bbeb11ea312abd5032bd539fa8ce477c87be927dbb52a653a44bcf87f894`；8条历史输入曝光标记全部true，保留同一DSH session标识。操作前后记录相同，没有借重启重放已有操作。

| 条件 | 摘要提交／失败 | 可见有效／未解析摘要 | 谱系／可见深度 | runtime关闭重开 | 重启自动模型调用 |
| --- | --- | --- | --- | --- | --- |
| full | 0／0 | 0／0 | 0／0 | 0 | 不适用 |
| compressed | 8／0 | 5／0 | 2／2 | 0 | 不适用 |
| compressed-restarted | 8／0 | 6／0 | 2／2 | 1 | 0 |

两压缩组的8份初代摘要清单均记录`deepseek-official/deepseek-flash`。实际二代来源是`deterministic-lossless-pack-v1`的`composition.generation=1`，加上初代构成深度2；**它是实际运行中组合真实模型摘要，不是第二轮语义改写模型输出，也不是scripted重复夹具。** 两组`scriptedDuplicateFixture=false`。
compressed在session seq208组合4份父清单、16个片段；restarted在seq181组合3份父清单、12个片段。独立核对父manifest／view位置、重建父可见文本hash、父模型来源，以及每个子片段到父片段的kind／text对应，均无不一致。依赖继续指向原task的execution-input来源。
重启指本地runtime关闭后以既有profile重开，并沿用原DSH session；不是服务器重启。记录与冻结驱动的第4次延续后关闭／重开路径相符，`restart-no-automatic-call=0`，没有把恢复本身算作模型完成。

## 费用与原时钟连续性

本批183次真实调度均有匹配started／finished／settled记录，requestHash、sessionHash、reservationId及attempt关联一致，无调用error；39次task、144次compaction，均为`deepseek-official/deepseek-flash`、effort=max。新增费用 **2861062微元（2.861062元）**，与逐项相加及原停止点增量一致。

| 项目 | 已闭合截点 |
| --- | --- |
| 原不可变config累计上限 | 60000000微元 |
| 单次追加授权后的有效累计上限 | 97894922微元 |
| 累计usage计费 | 31576336微元 |
| 历史9笔全额上界记账 | 19179648微元 |
| 累计保守spent／剩余 | 50755984／47138938微元 |
| 当前held／未计入unknown | 0／0 |
| firstCall／expiry | 1792959270580／1793132070580 |
| 累计active／剩余active | 8383150／13216850ms |
| 本批执行增量 | 944847ms |
| 累计calibration／已分配校准上限 | 4027578／5400000ms |

授权修订事件仍只有1份，baseline.spent=47894922；原9个reservation仍保留unknown实际费用状态，每笔恰有一份全额上界记账事件，未被当作已知真实费用或删除。31576336+19179648=50755984；97894922−50755984=47138938。
8383150+13216850=21600000ms（原累计6小时）；firstCall+172800000ms=原expiry（48小时）。本批execution.stopped事件elapsedMs=944847，与原active7438303到当前active8383150差值一致；最终active_since/pid/phase均null，batch.running=false。
关联machine导出在stop前取样，仍记`running=true`、active8381764；闭合batch与账本为8383150，相差1386ms。二者是不同取样截点，本文最终预算／时钟以闭合batch和只读账本为准，不据早一刻的导出误判执行器仍在运行。

## 适用范围与下一冻结边界

导出明确`realPlatform=false`、`serverAccess=false`、`humanAccepted=false`、`overallTestsComplete=false`；本批是付费真实模型配合本地虚构环境，没有QQ／Bili真实平台或服务器验收。自动检查与本次AI证据复核不代替回答语义充分性审阅。
同candidate关联的正式case attempt为 **0/162**；正式矩阵尚未开始，旧候选的历史尝试及失败保留原义。R6管理员CLI／Host接线改变运行候选后，必须重新freeze并对新的candidate执行校准，再决定正式162项的执行；本批五项仅证明上述冻结身份，禁止搬成未来候选的通过结果。
