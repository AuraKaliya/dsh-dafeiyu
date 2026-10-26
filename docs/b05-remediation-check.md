# B05材料、任务与来源修复检查

2026-10-26，按52840b3实施。新增b05-message-v2输入协议，提供公开虚构的南厅10:00与预约Q-17两事实及一致的管理员引文；薄适配层使用QQ实际分类和核心submit/status/control，逐条核验真实身份、自然委托、同Task续办与目标版本。原suite文本及旧attempt/失败均保留，新输入在新candidate中明确记录，不能拼作旧B05重跑成绩。

来源方面：受信SDK isError回执保留诊断与继承依赖；无该标记的错误样文本不获豁免。event元数据保持可读索引、不能充当新的primary正文；合法message和独立tool-result来源则按相同scope/hash/有效性规则读写，撤回与旧hash仍被拒绝。没有关闭来源失效保护。

首次相关组合报告 `.runtime/test-reports/a6f7fead-68e3-4144-98b2-98faa7347f9d.json` 中，新B05协议／薄适配和漏受理、漏续办、错误Task的正反例，既有provenance、memory、timeline、QQ受理／控制组均通过。唯一B05新增来源测试失败，揭示timeline读取agents服务却漏声明Cordis依赖，fail-closed将合法来源拒绝；已补充服务注入及对应现有版本peer/lock声明，未删除或降低断言。

定向复测报告 `.runtime/test-reports/460f24cb-7025-4fe7-8497-811152a58147.json` 共21/21通过，其中B05来源5项全部通过；其余为R1迁移修正。覆盖SDK参数错误、伪装error、原来源撤回、event索引不能洗成primary、合法独立工具证据写入后检索仍有效且撤回即失效。成功D盘现场已清理，无清理阻断。

所有结果均为离线／transport-test，未调用真实模型或平台、未连接服务器。新B05真实三形式×三重复仍待R5冻结后验收；旧failed未改判。数据和用户未提交文件均保留。
