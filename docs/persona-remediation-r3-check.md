# R3 采用门槛与多 Run 集成检查记录

2026-10-26。本记录汇总已执行的定向程序检查与 AI 诊断；不是独立人工语义验收、真实模型验收或全量发布通过。最后一项来源撤回集成测试已修正夹具 SQL 并完成复测，下文保留失败和修正记录。

## 已完成的采用门槛检查

主代理统一执行的报告 `.runtime/test-reports/c3597c35-182b-43d3-a308-f8202091a8c0.json` 中，以下 R3 文件全部通过：

| 文件 | 结果 | 检查范围 |
| --- | --- | --- |
| `tests/persona-adoption-policy.test.ts` | 19/19 | 原始动机、精确范围、实际闭合试行、来源覆盖与反证、tentative／established 资格 |
| `tests/persona-adoption-state.test.ts` | 7/7 | 采用评审及发布重核、Decision 与候选原子提交、旧捷径拒绝、来源变化、批量回滚与幂等 |
| `tests/persona-adoption-contract.test.ts` | 8/8 | 严格输入／记录契约、旧命令读取兼容与新采用证明要求 |

这份报告的整体结果是51项中48通过、3失败；失败来自当时同组的 R4 tooling 文件，不能将它写成整组通过。构建、普通测试类型检查及 tooling 类型检查均 exit 0。以上34项已实际通过，未因后续测试组启动而被表述为重新执行。

## 本轮集成组

报告 `.runtime/test-reports/6b24508b-93a0-416d-aca4-b6f180c55579.json`，2026-10-26T11:00:28.681Z—11:02:00.177Z。
构建、普通测试类型检查及 tooling 类型检查均 exit 0；整组 **55项中54通过、1失败**，取消／跳过均为0。与本 R3 记录直接相关的结果如下；同组其他 R4 检查不并入下面文件的项数。

| 文件 | 结果 | 已实际验证的行为 |
| --- | --- | --- |
| `tests/persona-state.test.ts` | 12/12 | 原直接采用夹具改为真实三 Run；范围隔离、重启、撤回、事务回滚、并发及原有执行边界保持 |
| `tests/experience-persona-basis.test.ts` | 1/1 | 经验来源约束与新的采用流程兼容 |
| `tests/qq-task-delivery.test.ts` | 12/12 | 原任务交付夹具与采用约束兼容，交付边界保持 |
| `tests/persona-adoption-integration.test.ts` | 3通过、1失败 | 前三项公开工具链通过；最后的来源撤回竞态停在测试 SQL |

三 Run 流程依次为：提出候选／review 为 trial／selectTrial；独立正常可见 Run 实际装配并闭合；后续 Run 引用该 Outcome 作 reviewAdoption，再 publish。兴趣测试通过受信任务生产者明确设置原始 self-exploration 动机，没有把默认 explicit-task 更名为探索或放宽生产规则。

公开工具集成已通过的三项确认：

1. 同一 Run 内 propose→review→select→publish 缺少采用评审时，工具返回 `PERSONA_ADOPTION_REVIEW_REQUIRED`，effects=none；没有 Outcome、Review、Decision、adopted 选择或发布记录。
2. 合法三 Run 能采用仍为 tentative 的兴趣；发布前保存的实际清单仍是 trial 投影，发布 Run 继续完成可见输出。重复同一 publish 请求只保留一次发布、三版候选及两份 Decision（评审预览与发布重核），新的 Run 使用 adopted 投影。
3. explicit-task 的兴趣即使已有独立 completed 试行，采用评审仍因 motivation-mismatch 为 held，publish 无效果，原动机和 trial 状态保留。

persona-state 的回滚检查区分已存在的评审预览 Decision 与新发布 Decision：注入发布失败后，候选版本、阶段版本、两种选择及 Decision 数量均回到发布前；撤销故障后原请求可成功，回放不增加记录。

## 唯一失败及最小修正

失败测试为 `source withdrawal after an allowed review prevents publication and cannot reuse that preview as authority`。主代理报告的失败位置是编译后 `persona-adoption-integration.test.js:253`，SQLite 报 `no such column: agent_id`。
测试已实际走到 allowed Review 后的外部来源撤回步骤，但夹具将 `execution_sources` 误当成含 `agent_id` 的表，因此尚未执行预期撤回，也尚未验证之后的拒绝发布断言。不能将这项记作产品门槛失败或通过。

已对照 `packages/memory/src/migrate-execution.ts` 的实际 schema：该表以 `id` 为主键，范围列为 `scope_key`。只将测试 UPDATE 的 `id + agent_id` 条件改成 `id + scope_key`，参数采用原候选 contentRef 的精确 id／scopeKey；仍断言恰好更新一行。没有修改业务代码、状态／结果／记录数量断言或评分标准。

修正后本代理已停写，未自行运行测试。主代理计划仅复测 `tests/persona-adoption-integration.test.ts` 四项；本记录在收到实际结果前保持“待复测”，不将之前通过的其他文件写成再次运行。后续复测结果由主代理追加。

## 执行与清理边界

这里的真实 core／memory 指本地产品模块、SQLite、公开工具接口及 DSH 生命周期。模型生成仍为 scripted fixture，资料均为虚构样本；最后一项用受管测试数据库的外部来源状态变化模拟撤回竞态，不用模型伪造 Admission 或 Outcome。
两份报告均为 `realModel=false`、`realPlatform=false`、`serverAccess=false`。没有付费请求、真实 QQ／B站发送、服务器操作或正式 7C 账本变更。

本轮临时数据统一在 D 盘项目 `.runtime/tests/`。报告6b24508b的 cleanup.blocked=[]；按既定策略移除了旧失败 run `6e95f569-4047-47fc-8d5b-2cc1c59e16eb`，保留本次6b24508b、前次c3597c35和R2的e99e72fc三份失败现场，合计219282326字节，低于1 GiB。未手动清理正式验收证据，也未宣称失败现场已全部删除。

## 最终复测与 R3 结论

主代理在报告 `.runtime/test-reports/0a19c770-3fc4-44eb-bc9c-e8d5040c4c79.json` 中仅重跑本 R3 尚需复测的 `persona-adoption-integration`，四项全部通过。来源撤回竞态已实际发生；allowed Review 之后的发布被阻止，未新增采用修订、阶段选择或提交 Decision。之前通过的其它 R3 文件未重复执行。

同一组还运行了 R1 Host 补修及 R5 维护入口检查，整体63项中62通过；唯一失败是 Host 记忆流程包装测试仍断言旧版本11（实际子流程已返回 passed=true、schema=12），与本R3四项无关，另行修正和复测。不能将该组合报告写成63项全过。

R3共63项不同相关检查已通过：策略19、Store7、契约8、原人格状态12、公开工具集成4、经历来源1、QQ交付12。共同入口的独立静态复核未发现新的绕过；模型语义仍未验收。所有新采用必须经过真实装配／闭合记录、不可变复核和提交前重验；历史v1保留，不补造试行。此阶段实现与定向检查完成，进入R4／R5，不因此释放真实调用或服务器部署。
