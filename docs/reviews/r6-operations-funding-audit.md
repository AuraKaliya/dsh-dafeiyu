# R6 运营资金模块静态审计

2026-10-27。依据 `docs/server-runtime-production-launch-plan.md`（7521341）检查当前 `funding-config/files/store.ts`、`operations-authority.ts`、SharedModelBudget、production/lifecycle 接线及三组测试。性质为 AI 独立代码审查；未改源码、未构建/测试、未创建任何真实额度、未访问服务器或模型，也未读取/复制 7C 账本。

## 结论

发现 3 类可复现场景，已发根代理和 C：时钟停止事实可被重启绕过、异常原始回执归一化后失去冲突身份、到限拒绝未必触发停止新消息/Task 的回调。前两类在本次资金实现中，第三类属于当前运营 authority 与共用预算/启动生命周期之间的接线缺口。未发现原子余额预留、BigInt 计费或 unknown 占用中的直接退款/超额放行路径；这不抵消上述期限与停止问题。

本截点未取得这批实际测试报告，不能写成运营资金验收通过。所有下述数字/时钟序列仅说明合成测试，不是新授权。

## 审查截点

| 文件 | SHA256 |
| --- | --- |
| `funding-config.ts` | `9b10de11df49e08280d3edbd8d1288df5c97325f9c9cdc9393fcfe7f543c91c3` |
| `funding-files.ts` | `94026d87d45c1f8c6916c7cbb0a2f38f44e1ca408547ab4ad7367892a387fd58` |
| `funding-store.ts` | `c9450ce770966ec89ae2dd3b8aa57a6f4df0297467ae23af31e33f3c9cae31c8` |
| `operations-authority.ts` | `c76f1eb57f91d3298c4024626d92846cd1eecd4ce4d02a04dfa25b217bd1ed90` |
| `shared-budget.ts` | `db36ad810549d173ec63bb95a40f9a602daa95e724b593299093bb4c3ed8e351` |
| `tests/server-operations-funding-store.test.ts` | `e2123c671962eaafcd0703d2a05b80f867288d6bce25d5f004b2fda65249d2af` |
| `tests/server-operations-funding-authority.test.ts` | `93ce7fd1ae1116bdfa59d8a7ca680f13f8ecb7ba7fb8ac57e556906a6e79912f` |
| `tests/server-operations-funding-stop.test.ts` | `466172c69af9f6d6e319dc34a7366ebf768378b957e73476927856b2c1d5df32` |

前5个路径相对 `packages/server-runtime/src/`。实际文件列表中尚未出现本计划的薄 CLI/全窗口启动器实现，不能把将来启动器应做的工作视为已经接好。

## 1. 时钟已观察高水位及单调耗尽未持久（期限阻断）

`funding-store.clock(now,write=false)` 只有 write=true 才更新 last_seen；guardLease/admission/remainingMs 都只读它。authority 只保存 lastMonotonic，没有最高已观察 UTC。

可复现序列一：

1. 在 T 激活 synthetic authority，不预留任何调用。
2. wall 和 mono 都前进60秒，调用 guard；检查会成功，但数据库 last_seen 仍是 T。
3. wall 回退30秒、mono不回退；再次 guard 仍通过，因为它只和 T 比较。
4. close 只保存 T+30秒。重开 authority 会以新的 monotonic 起点重新计算 expiresAt−(T+30秒)，比已耗60秒恢复了30秒余量。

可复现序列二：wall 保持不动，mono 超过 initialRemaining，remainingMs 已抛 FUNDING_EXPIRED；close 后再打开仍得到原 expiresAt−wall 的完整余量。当前测试只检查单次进程内抛错，没有检查此停止事实在 reopen 后继续有效。

最小修复要求：已观察 UTC 不能回退；最高观测及单调期限耗尽的保守停止事实须跨关闭/重启保留。可使用明确的持久时间下界或停止事件，但不能把根据 mono 推算的值标成真实观察 UTC。结算仍须接受已经欠下的账目；修时钟不能变成拒绝结算或退款。

## 2. 先归一化 usage 再算回执身份（审计冲突缺口）

`funding-store.settle` 先将非法 usage 或 error/aborted/interrupted 的 usage 置 null，并把非法情况 error 改成 FUNDING_USAGE_INVALID，再计算 requestReceiptHash。

复现：同一 reservation 首次提交 `inputTokens:-1` 的非法 usage，第二次提交另一份不同的非法 usage，其余 envelope 一致。两者归一化后的 receipt/hash 完全相同，第二次被当作幂等而不是 FUNDING_SETTLEMENT_CONFLICT。error/aborted/interrupted 下不同的原有效 usage 也会丢失差异。

unknown 的预留仍保留，因此本发现不是退款绕过。问题是原始异常回执身份无法区分，违背计划中“重复完全一致幂等、不同回执冲突”的证据要求。建议保存有界原回执的独立摘要用于重放检查，计费归一化另存；无须把任意未分类 raw payload、秘密或内部思考写进账本。补同 reservation 两份不同 invalid usage 的负例，并明确原始摘要与费用摘要的用途。

## 3. 到限拒绝没有完整联动新准入停止（接线缺口）

当前 SharedModelBudget.reserve 在 gate.acquire 前调用 remainingMs，进入 try 后先调用 assertReady；这两处 authority 失败不经过后面的 authority.reserve catch/cancel。operations authority 到期，或余额精确为0时，可直接抛出而不关闭 gate，也不调用 onInterrupt。当前也没有覆盖“没有活动调用”的全窗口期限 timer；已有 timer 只属于单次调用或关闭排空。

复现：真实 synthetic OperationsModelBudgetAuthority + SharedModelBudget，注册 onInterrupt 计数；将 FundingTestClock 推到期限后 reserve，调用被拒绝，但 status.stopped 仍为 null、回调计数为0。若 Core 已激活，其新消息/Task受理仍开放。模型确实没有派发，不等于已经停止新业务准入。

现 stop 测试使用 FictionalBudgetAuthority 并显式调用 budget.cancel，只证明取消回调能够 quiesce 实际 Core，未证明运营资金的真实期限/余额终态会触发它。正式薄 launcher 或预算边界应明确承担全窗口停止和终态 admission fault→cancel 接线；增加实际 Operations authority 的合成回归，同时保留已持有账单的结算能力。

## 已核对的有效设计

### 一次初始化与缺库保护

- operatorInitializeFunding 要求窗口目录、initializing、initialized 凭证均不存在；以 exclusive claim + fsync 先占 fundingID，再创建独立目录/数据库及事务 schema，最后 exclusive 完成凭证。相同ID不能换路径绕过绑定；部分初始化留证而不自动重试。
- 普通 open/inspect 不调用 initializer，不创建目录/marker/DDL；先核对两份外部凭证、物理根/目录/数据库身份及原授权/价格，再 readonly 打开。writable 路径持 readonly handle 后再打开并比对身份；它未使用显式 SQLite mode=rw，不能额外宣称已完成恶意并发路径替换的零创建合同验证。
- 路径拒绝穿越、UNC、符号链接/junction祖先、文件hardlink；dev/ino 由 BigInt 派生，不使用 Number inode。凭证与窗口目录分离且不互相包含，授权/价格文件不得放入其中。
- schema/application_id、完整DDL/不可变触发器集合、quick_check、metadata binding 都被检查；缺库或凭证缺失不会靠正常启动补出新余额。

### 余额与结算

- reserve 的余额派生、未结/unknown检查、callId唯一检查和插入位于同一个 BEGIN IMMEDIATE。共享父/多个child通过 FIFO 只持有单次调用许可，不锁整个 Run。
- 费用为 BigInt 的加权和一次 ceil；输入预留取三个输入桶最大费率，output已包含reasoning不重复加算。金额输入是安全整数微元，派生支出/异常大额以十进制字符串保存。
- missing/invalid usage、失败/中断及超界用量归 unknown，保守占用至少预留与可算实际费用的较大值；未结判断看 reservedCalls，不只看 held金额。
- settle 不走余额、期限、caller grant 的派发准入，已经欠下的账目可在期限之后或 UTC 回退时记录；nonce/call/reservation/owner绑定仍校验。未结 reservation 阻止 releaseLease 和下一次业务 claim，重启不退款、不假结算或重发模型。

### lease、激活与追加

- claimLease 在事务内取得 starting nonce；只有 active lease 可 reserve。现存 PID 活着或不能确认消失时不抢占，不以heartbeat到期强占；PID复用仍保守视为owned。旧 owner 不存在也必须没有未结/unknown。
- activateLease 检查当前PID、fresh observedAt、Node路径/hash、固定SID、elevated/Admin/nonrestricted等字段及同一 starting nonce。资金层校验的是证明结构/绑定，真实OS事实必须来自固定 Windows factory；当前测试用 synthetic proof，不能称其已验证真实管理员token。
- 默认 operations 拒绝 synthetic purpose/approval；operations authority 禁止 clock/processState 测试hook。synthetic 模式返回 offline-test，production factory 拒绝该 kind。当前没有审到完整正式 CLI，不能声称其参数入口已验收。
- 初始授权和价格按原文件 bytes SHA256 绑定，metadata及链保存初始结构；每次派发重新核验原文件/凭证，不悄然更换价格或授权。approval.reference/hash 是批准材料的记录，不是库本身生成或独立验证的人类同意；可信 operator 流程仍须消费真实已批准原件。
- amendment 仅 idle 且无未结调用时追加；前驱hash、fundingID、初始授权、host/route/price、原 expiresAt全部绑定。增加额度不改旧行、不延长窗口，也不清除 unknown；unknown 后即使金额增加仍不能 claim 新业务。

## 合成测试范围与待补

当前三组分别为 store 6、authority 8、stop 1，共15项，另有独立fixture。覆盖缺库/丢凭证、一次初始化、原授权/价格变化、整数缓存计费、unknown、超大usage、单次时钟检查、活/不明lease、遗留未结及追加不解unknown。测试只创建受管D盘 synthetic材料，未消费真实运营资金。

尚缺上述三类明确回归：无reserve期间的高水位/回拨/重开、单调耗尽后重开、不同非法原回执冲突，以及真正 Ops 终态触发 Core 停止新准入。现有余额测试体现单库事务和同进程共享 FIFO，不是一次已经执行的多进程资金压力证明。

本审计没有运行任何测试或生成付款材料。根代理与 C 后续修复、统一构建及定向结果应另行追加，不能用本文代替生产金额授权、服务器启动或真实付费验收。
# 复核结果补记（2026-10-27）

主代理已核对修复：原异常回执独立有界指纹、持久 UTC/剩余时间上界/终止原因、authority 到限通知及真实 Core 准入停止均已补齐。新增 22 项资金相关检查与 19 项受影响检查中，首轮 38/41 通过；三项停止断言按实际关闭契约修正后 3/3 通过。记录见 `../server-runtime-r6f2-funding-check.md`。资金作用域已从易变 release 配置指纹分离为 `scopeHash`；启动竞态及真实 OS 工厂装配仍是后续范围。本补记是主代理复核，不冒充原审阅者重新完成独立审查。
