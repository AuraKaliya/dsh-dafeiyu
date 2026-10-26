# R1契约、迁移与兼容检查记录

2026-10-26，按f0279d5实施。新增试行选择／装配／结果、采用复核／决定、来源性质及成熟度契约；v1候选和Run清单保持原字节读取，新v2明确区分试行与采用。主记忆库从11追加迁移至12，新建9张证明表及外键、不可变、唯一键和依赖索引，不改旧候选、stage、记忆、回执或hash。host探测、迁移版本guard和备份检查同步更新。

第一次完成的相关组合检查为154项、150通过，报告 `.runtime/test-reports/a6f7fead-68e3-4144-98b2-98faa7347f9d.json`。R1新增契约7项、迁移6项全部通过；另有3个旧迁移测试写死11／3版本预期，已改用当前memory/runtime常量，保留旧行及hash、无自动采用和恢复断言，没有降低检查要求。

定向复测 `persona-foundation-migration`、`storage-migration`、`b05-source-contract` 共21/21通过，报告 `.runtime/test-reports/460f24cb-7025-4fe7-8497-811152a58147.json`。此前通过的其它组未重跑。两轮均为D盘受管离线测试，无真实模型、平台或服务器调用；成功现场已清理，清理blocked=[]。整套全量回归尚未运行。

已验证旧数据无损、schema组合合法、无评分／伪身份输入、迁移中断回滚、重开幂等、缺表／缺触发器拒绝、未来版本拒绝、备份包含新表。Schema可解析不等于采用资格已经实现；R2/R3的实际试行装配、可信回调和publish门槛仍在后续步骤。

本次只提交R1范围；用户现有 `docs/memory-phase-1.md` 未编辑或暂存。正式7C的95份profile及账本未做memory迁移，原第52项失败保留。

## Host版本准入遗漏补修

后续只读部署复核发现，R1漏改Host的三处版本接线：`profile.ts`仍以memory v11作准入目标，v12初始化／迁移后会持续报告`HOST_MIGRATION_REQUIRED`；`runtime.ts`的快照类型和输出仍声明v11；`status.ts`只解析v8—v11快照。已改为复用`@dafeiyu/memory/store`的`MEMORY_SCHEMA_VERSION`，状态读取保留旧v8—v11分支。未改变启动、恢复或关闭流程。

定向测试新增／加强`host-profile.test.ts`的init→inspect当前版本就绪、`host-cli.test.ts`的合成v11→显式迁移→inspect→start／stop／status，检查旧记忆行与hash不变、未自动生成试行／采用证明，并保留v11旧状态快照可读断言。截至本补记仅完成源码与测试修改；尚未构建或运行这些补修检查，待主代理统一验证，不计入上文已通过数量。

上述待测状态已由主代理执行关闭：报告 `.runtime/test-reports/0a19c770-3fc4-44eb-bc9c-e8d5040c4c79.json` 中 host-profile 12项、host-cli 8项、host-runtime 20项全部通过。该组总计63项62通过，唯一失败是另一个`host-memory-flow`包装断言仍写死旧版本11，而实际子流程已正常完成。已将该预期改为同一个`MEMORY_SCHEMA_VERSION`，保留子流程的选材、维护、重启、撤回及零额外模型调用断言。

仅复测`host-memory-flow`的报告 `.runtime/test-reports/925f8090-0646-4def-89f1-299b63f60bf5.json` 为1/1通过，之前40项未重复。成功临时目录已自动清理，blocked=[]；全程本地虚构资料与脚本模型，未连接真实模型、QQ/B站平台或服务器。Host v12准入、迁移后启动及新旧状态快照读取的实际遗漏已修复，不是仅调整文档版本号。
