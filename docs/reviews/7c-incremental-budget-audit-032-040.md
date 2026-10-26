# 7C 第 032—040 项增量预算与证据复核

2026-10-26，AI 只读复核，非独立人工验收。未发现本次检查范围内的重大异常。

起点：`reports/2c302b46-a4e2-48b2-84c6-03fa3749cee2/index.json`，`2026-10-26T07:41:19.340Z`，74 attempts、1161 次派发。
终点：`reports/55e9d005-ae93-44ae-86f3-3c711f6e09a1/index.json`，`2026-10-26T08:12:16.305Z`，83 attempts、1253 次派发。
以上相对路径均位于唯一 campaign `.runtime/acceptance/7c-20261026`；本结论不包含终点之后的运行。
终点索引 SHA256：`befa61592ad950347a77acf8ba09d21678b5568c4b9d7e7ef57fa7531a34021b`；machine SHA256：`81c8672e3f5e1f1164aab463b2ebf89948ded69ad9183788cde86b282695044e`，均已核对。

## 增量调用及原证据保留

旧调用前 36 个完整页的声明哈希一致，第 37 页旧前缀逐条一致；旧 attempt 第 1 页哈希一致、第 2 页原有 10 条逐条一致。未重扫旧 profile，也未重读全部旧调用页。
新增 9 attempts、92 组 started/finished（184 条事件），配对、请求／会话／预留引用及时间范围一致，全部归属新增 attempt。新增调用均有 usage、无新增未知费用或调用错误。

| 序号 | 场景 | 新 attempt | 调用 | usage 金额（元） | 程序状态 |
|---:|---|---|---:|---:|---|
| 032 | H05-compressed-restarted-3 | `cf6bc635-d87b-4c0a-83ca-584713fcd10b` | 34 | 0.501412 | needs-human-review |
| 033 | B04-neutral-1 | `d57ef431-992a-4b4b-aa92-249aa62fae06` | 1 | 0.023058 | needs-human-review |
| 034 | B07-neutral-1 | `35d22913-984d-4550-b58a-7a581be81e20` | 3 | 0.093780 | failed |
| 035 | B03-paraphrase-1 | `6e6365f3-715a-42b7-8fce-5dec518d7a0f` | 2 | 0.061294 | needs-human-review |
| 036 | B06-paraphrase-1 | `49a6613b-e6b6-4b11-b70e-d32b0c3b5920` | 3 | 0.075868 | needs-human-review |
| 037 | H02-compressed-1 | `e28177e2-8adf-48b8-b568-3e4cf2365a78` | 39 | 0.606246 | needs-human-review |
| 038 | B05-paraphrase-1 | `8a818598-fb22-425e-9109-1c1f23204a81` | 7 | 0.115656 | needs-human-review |
| 039 | B01-pressure-3 | `eda5f6ff-8451-4f57-a4e8-ad607156cdd4` | 1 | 0.021756 | needs-human-review |
| 040 | B07-paraphrase-3 | `8e005e45-842d-4fe5-98f9-facdaf19ce04` | 2 | 0.057454 | failed |

对新增 9 份已关闭尝试核验全部 artifact 引用、9 份 profile 清单及其 103 个原始文件（12560626 字节）、97 项程序证据哈希、答案哈希、新增评阅映射、4 个批次与 controller 封存文件，均匹配。有限增量共读取 152 个唯一文件，无哈希或关联错误。
原 29 项评阅映射保持原 attempt 与 candidate；新增 attempt 中没有原 needs-human-review 场景。新增批次 executed 顺序恰好对应上述 9 项，先前通过项记录为 skip-pass，没有重跑。
H05 原失败 `d3fa411f-2651-41ff-a887-74358e8c3591` 原样保留，新尝试 ordinal 从 1 增为 2；两者引用同一 `baselines/430ff13b1608d867/H05-3.json`，SHA256 同为 `8a73c8f4ff90cc113a3876f168a877514e1e874b31b7870fa10fa3a52134134e`。新尝试全部程序检查通过，仍待语义评阅。

## 费用及累计钟连续性

按冻结单价对新增 92 笔 usage 用整数微元重算，合计 **1.556524 元**，恰等于两报告 usageBasedSpent 差额。
原第 9 笔 reservation `f5b965a0-46d3-429b-91fd-6c18757bbbf8` 在旧调用边界仍无 usage；新报告仅新增这一笔全额保守记账 **2.131072 元**，前 8 笔记账内容不变，`actualFee:unknown` 保留。

| 项目 | 起点（元） | 终点（元） |
|---|---:|---:|
| usage 计费 | 23.488962 | 25.045486 |
| 未知费用全额记账 | 17.048576 | 19.179648 |
| spent | 40.537538 | 44.225134 |
| held | 2.131072 | 0 |
| remaining | 17.331390 | 15.774866 |

等式成立：40.537538 + 2.131072 + 1.556524 = 44.225134；17.331390 − 1.556524 = 15.774866。第 9 笔只是占用转记账，没有释放预算。历史实际费用未知仍为 9 笔；终点未知未处理为 0、held 为 0。原总上限 60 元与阶段分配均未变化。
四个新增封存批次的累计钟为 `6098597 → 6145411 → 6195912 → 6491025 ms`；相对起点 `5916962 ms`，分别增加 `181635、46814、50501、295113 ms`，合计 **574063 ms**，各增量不超过对应批次墙钟跨度。
终点累计 **6491025 ms**、剩余 **15108975 ms**，合计仍为原 21600000 ms（6 小时）；校准累计 `3082731 ms` 不变。四批均已停，未发现回退或重置。
firstCall 仍为 `1792959270580`，expiry 仍为 `1793132070580`，相差 172800000 ms（48 小时）；到期为北京时间 2026-10-28 04:14:30.580。

## 候选标签与限界

新增 9 份 case 与 4 个批次一致标记实际冻结 candidate：codeRevision `15c38e250e143e63b902255369a272856deeef8d`，runtimeHash `b8a4365c16f5ee5a22baff55c1f6404322baf30e39f9d70c13c99420aad6cf8a`，protocolHash `4c33705ebdf1ded8f52ef4f850fa64954fe03d0f9404c322c2eb14945a53f614`。
四个 controllerRevision 分别为 `4ff9189`、`a23be0f`、`f3834eb`、`dd5062b`，与产品 candidate 分字段封存。campaign.config.codeRevision 的 `00f7c56` 是创建时元数据，不能当作上述新增样本的实际候选。
终点评阅映射仍含 8 份 `525deda` 与 28 份 `15c38e2`，没有把旧结果改称新版本重跑；`humanAccepted=false`、`semanticAssessment=not-performed`、`overallTestsComplete=false`。新增两项 B07 failed 及旧失败均未在本报告中改分。
本次只读指定冻结报告和对应闭合证据；未读取实时账本／导出／锁或在途 profile，未构建、运行测试、调用模型、连接服务器或操作 Git。累计钟结论来自已封存的四批 execution 快照，未再次重建实时账本全量事件；usage 金额也不等于供应商最终账单。未做第二轮旧材料全量扫描或人工语义验收。
