# 记忆与成长统一入口检查

2026-10-27。新增 `MemoryGrowthProvider`、Core `bindGrowthProvider` 与 Memory `growth: GrowthService`。旧 `PersonaProvider`、`bindPersonaProvider`、`memory.persona` 均为同一实例/绑定的兼容名称，不创建第二个写入者。候选、试行、采用、关系和偏好仍由同一 Memory 存储处理；Core 继续读取范围内快照并回报实际使用。底色文件及现有保留策略未改，数据库无需升级。

相关4个测试文件19/19通过：persona-state、persona-trial-integration、persona-adoption-integration、experience-persona-basis。覆盖跨场景隔离、连续三轮试行、来源撤下、原子失败、重启接续和历史输入保留。

本机运行真实DSH/SQLite，模型为脚本模拟；未调用真实模型或平台、未连接服务器。报告 `790a6f99-64bc-4a17-a2ef-401633b09339`。成功临时目录已删除，cleanup.blocked为空。
