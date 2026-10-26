# R2 核心与记忆联合检查记录

2026-10-26。本阶段已实现并定向检查试行选择、实际装配 Admission、闭合 Run Outcome、authority 约束及无模型恢复。以下是程序检查和 AI 诊断，不是独立人工语义验收，也不是整体 7C 或发布通过。

## 实现范围

- memory 将 trial 选择与 adopted 选择分开；试行正文标明暂定、适用与退出条件，保持来源性质、覆盖范围和原谱系。
- core 将实际进入预算的 trial 条目单独写入 v2 manifest；projectionHash 为 `runtimeHash(entry.item)`，遗漏项不登记为使用。旧 v1 清单与正文/hash 继续读取。
- Admission 使用 `store.start` 后的实际持久清单，包含最终 continuityCheckpointId；provider 回调通过 WeakMap 对象身份、精确输入 hash 与有效期核验取得真实 Run/scope/origin access。
- Outcome 在 Run 终态及结果持久后生成，closedEventId／closedAt 来自原不可变 `run.<state>` 事件。失败／中断不补造完成文本，unknown 操作不提升为成功；会话 Run completed 不等于平台已发送。
- 恢复只补投已有 Admission 对应的缺失 Outcome，不补造过去的 Admission、不重新调用模型。确认丢失沿用原事件／结果／引用；来源不可核时保留缺口，不自动采用。
- 原 Run 的精确 trial 投影可在合法、同内容的 trial→adopted 后继续核验；不以当前全局 trialSelectionVersion 是否变化一概判失效。新的 Run 由当前合法选择装配。

## 第一轮联合检查与失败定位

主代理通过受管入口执行联合组，报告 `.runtime/test-reports/e99e72fc-6a4b-4fad-a20d-e5b14ff48f5b.json`。
构建、普通测试类型检查、tooling 类型检查均 exit 0；72 项中 **70 通过、2 失败**，失败均位于 `persona-trial-integration.test.js`：

1. 真实 core／memory 配合 scripted DSH 的第二个 Run，应完成实际试行却得到 failed。
2. 注入 Outcome 写入失败后的恢复场景，同样在第二个 Run 提前失败，尚未进入预期 Outcome 故障阶段。

两份失败现场分别保留在该 run 的 worker `05444ed5-97be-4a1b-bcf5-0aae6994cbe4` 下 `persona-trial-integration-XsOsL5` 与 `persona-trial-integration-Brm7wK`。只读核对显示：Run1 completed；Run2 SOURCE_STALE；候选仍为 v2/trial、任务仍 active/epoch 1，来源版本均为1且未删除，依赖图无环。
Run2 已保存完整 `persona-trial:admission-input`，manifestHash 与含 continuityCheckpointId 的实际 v2 清单一致，selection hash 也匹配；但没有 admission-receipt、memory Admission 或 Outcome。因此失败发生在 Admission 回调，不能归因为 Outcome 插入故障或清单哈希不一致。

根因是 Admission 的 authority verify 内重复调用完整 `prepared.guard()`。memory 正解析来源并将其加入 `PersonaService.resolving` 时，内部 `access.guard()` 再次触发 provider.prepare／来源解析，同一来源撞上正常循环保护，变成 SOURCE_STALE。core 专项的简化 provider 不包含该真实 resolver 路径，故此前 7 项通过未覆盖这个交互。
最小修复只调整 core Admission guard：回调内部继续验证 task 结构 guard、provider 身份／ready、真实 Run state、持久 manifest hash 和 running 事件身份；完整 `prepared.guard()` 放到回调前后执行。Memory 的精确来源／投影／selection 校验、WeakMap、输入 hash 和回调结束撤销均保留。

## 定向复测

主代理仅复测已有两份文件：

- `build-tests/persona-trial-runtime.test.js`：7 项 core 专项。
- `build-tests/persona-trial-integration.test.js`：2 项真实产品模块与 scripted DSH 集成。

报告 `.runtime/test-reports/7f425d17-5523-4dc5-83d0-1a2b98eb683f.json`，2026-10-26T10:46:33.492Z—10:46:44.390Z。
构建、普通测试类型检查、tooling 类型检查及测试均 exit 0；**9/9 通过**，失败／取消／跳过均为0。
本次没有重跑第一轮其它已通过项，不能将这轮9项写成重新执行72项或全量回归通过。没有为修复再造只镜像实现的断言，真实集成失败用例保留并作为回归。

本轮实际覆盖了 task 与 conversation 接线、最终 manifest 绑定、预算遗漏、authority 伪造／复制／修改／过期、失败与 unknown／interrupted 事实、Admission／Outcome 确认丢失、无 Admission 不补造、来源失效保留缺口、旧 v1 读取兼容，以及真实 memory 中多 Run 选择→使用→闭合／重启不重放。
其中 Outcome 插入故障用例验证：原 completed Run 和结果保持；恢复后只新增一份缺失证明，再次恢复不重复，模型请求数不增加。试行仍保持 trial，未因 R2 成功自动成为 adopted。

## 模拟与执行界限

“真实 core／memory”指实际本地产品模块、SQLite、DSH 会话和运行生命周期；模型后端仍是 scripted fixture。两份报告均记录 `realModel=false`、`realPlatform=false`、`serverAccess=false`。没有付费模型请求、真实 QQ／B站调用、服务器操作、正式账本重置或正式验收 profile 迁移。
本记录不确认语义充分性、采用资格、B05／B07／H05 的真实修复效果或 R3—R5 完成。R2 Outcome 是发生过的试行事实，不是采用许可；R3 仍须独立完成共享采用门槛及原生／maintenance 一致性后才能按既定方案准备真实复验。

## 受管清理

成功复测 run `7f425d17-5523-4dc5-83d0-1a2b98eb683f` 的 D 盘受管临时目录已自动移除，cleanup.blocked=[]。
报告保留三份既有失败现场：`6e95f569-4047-47fc-8d5b-2cc1c59e16eb`、`a6f7fead-68e3-4144-98b2-98faa7347f9d`、`e99e72fc-6a4b-4fad-a20d-e5b14ff48f5b`，合计191982343字节，低于1 GiB；没有把保留失败现场误写成全部临时文件已清空，也未手动清理正式验收材料。
检查记录由子代理整理，业务代码与测试执行由本轮分工负责、主代理统一调度和提交；本次文档整理没有新增测试或业务修改。
