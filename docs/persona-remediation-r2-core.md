# R2 core：试行装配、闭合证明与恢复

2026-10-26。依据已落盘 R1 契约实施 core 半边；memory Store／Service 与采用资格由主代理负责。本方案先提交，随后编码；本代理不构建、运行测试、提交 Git、调用模型或服务器。

## 责任与接口

修改仅限 `packages/core/src/persona-runtime.ts`、`index.ts` 的试行／生命周期 API、`runtime-store.ts` 的不可变事件读取／试行支持、`execution-coordinator.ts` 的 admission／completion 接线；新增 `persona-trial-authority.ts`、`tests/persona-trial-runtime.test.ts`。不改 contracts、memory、native-runtime、provenance。
PersonaRuntime.bind 保存并绑定 provider 的可选 `trialAdmitted`／`completeTrial`，保留正确 this。旧 provider 无 trial 时继续原路径。新 provider 提供 trial 条目却缺回调时不把它装成已可证明的使用。
core 新增 `assertPersonaTrialAuthority(authority,input):void` 和 `personaTrialAccess(authority,input):PersonaAccess`。后者来自本次回调绑定的真实 StoredRun、实际 inputs、origin、scope、epoch、动机及可见来源，memory 不猜造身份。对应 authority 不注册为工具，不可由模型获取。

## 投影与真实清单

`PreparedPersona.entries` 仍只表示 adopted；`trialEntries` 独立校验、计入同一成长区域预算，并在正文标明 projection=trial、maturity=tentative、适用／退出条件和 instructionAuthority=false。装不下或验证失败的条目计 omittedTrials，不作为实际使用登记。
新清单 v2 的 adopted 项显式带 adoption 分类；旧 provider 缺分类只作 legacy-unclassified，不标 reviewed。trialEntries 保存精确 candidate、trialSelection、contentRef、dependencies、projectionHash，projectionHash 绑定真正装入的 ContextItem。无 trial 的旧路径与旧 v1 读取/hash 保持兼容；不会重写旧清单。
task 的 `store.start` 写入实际清单（含最终 continuityCheckpointId）之后才构造 Admission；回调 manifestHash 取 RuntimeStore.personaBinding 的持久清单，不使用 prepare 阶段的近似对象。conversation 同样在真实 Run start 后登记，只有实际被当前 personaContext 装入的条目可登记。
admittedAt 使用该 Run 的不可变 run.running 事件时间；新 `RuntimeStore.latestRunEvent(runId,state)` 只读返回对应原事件 ID／at，校验 body 结构与 Run 身份，不使用稍后的 projection／delivery 事件代替运行闭合事件。

## Authority 生命周期与持久接线

`persona-trial-authority.ts` 用私有 WeakMap 绑定 authority 对象身份、输入规范 hash、受信 access 工厂和本次事实 guard。传给 provider 的输入为严格 Schema 验证后的固定快照；authority.guard 再核对活动回调和真实持久事实，guard 函数本身不授予权限。回调 finally 撤销；伪造对象、复制 authority、改 input、回调结束后复用均拒绝。
admission 输入按 R1 保存实际装入条目的受信 sourceEvidence。可在回调前以明确的“admission input”运行输入保存该快照，以处理跨库崩溃；它只表示 core 的实际装配，不冒充 memory 已保存 Admission。成功返回的 refs 另记运行事件，保留关联。
task 模型返回后先保存真实 result／Run 终态，再 completeTrial；失败、取消、中断在对应终态持久后同样接线。waiting 不伪装为 R1 的 closed terminal。conversation 在 completeWithProjection 持久结果之后接线；不等待或伪称平台 sent，也不能把平台回执作为 Run 结果位置。
Completion 的 completed result 直接取 StoredRun.result，closedEventId／closedAt 取同一 run.<state> 不可变事件。失败／取消／中断的 result 固定 null；operations 从真实操作表提取，unknown 保留 unknown。无 outcome 的操作以明确未知状态、缺口和原缺失值 hash 表示，不补造成功或可见文本。
Completion sourceEvidence 来自已封存 Admission 输入及当前能验证的合法结果来源；无法恢复或已失效的材料留 gaps，不提升来源性质或自动采用。发生回调失败时保留已闭合 Run，不把 completed 倒改成 failed，也不重跑模型；记录可重试的试行证据缺口。

## 重启与补投

提供显式 `core.recoverPersonaTrials()`：仅在 RuntimeStore 已完成 running→interrupted 恢复、persona provider.ready() 为 true 后调用；建议主代理在 memory 恢复就绪后、host activate 前调用。重复调用安全，不发模型或平台请求。
扫描已闭合且有 v2 trial 清单的 Run，以原清单、保存的 Admission 输入、原闭合事件及原 result 重新发送 Completion；不调用 trialAdmitted 重建过去的 Admission。memory.completeTrial 只匹配已存在的 Admission，缺 Admission 返回空／明确缺口，绝不现场补造。
因此，崩溃发生在 Admission 写入之前不会形成 Outcome；发生在 memory Admission 写入后、core 确认事件写入前，仍可通过已存在 Admission 与固定 Run 事实补完成。Outcome 写入后确认丢失时，以同一 closedEventId／result/hash 重试返回同一记录。
恢复只读取已绑定运行事实；当前输入／来源不可取得则报告缺口，不能读取其它域或让 memory 猜 origin。旧 v1 或没有 trial 清单的 Run 不生成新证明。

## 待交接的验证

新增定向测试覆盖：旧 v1/hash/provider 兼容；adopted 与 trial 分开装配；暂定标记、精确 selection/projectionHash、预算遗漏不 admission；provider this 绑定；authority 伪造／复制／改输入／过期拒绝；access 的真实 task/conversation origin 与 scope。
生命周期覆盖 task 与 conversation 的 start 后 Admission、终态和结果持久后 Completion、精确含 continuityCheckpointId 的 manifestHash、closedEventId 稳定、失败不伪造文本、unknown 操作保留、conversation completed 不等于已发送。
恢复覆盖四个窗口：尚无 Admission、Admission 成功后确认丢失、Outcome 成功后确认丢失、来源失效；只补投缺失记录、不重跑模型、不重新登记过去的使用。测试使用 D 盘受管虚构库及脚本后端，不访问正式 7C profile。
完成后交主代理统一构建和运行 `persona-trial-runtime.test.ts` 及受影响的 persona/runtime/execution/conversation 定向测试；测试准备与实际通过分别记录。
