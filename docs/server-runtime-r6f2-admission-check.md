# R6f-2a Host 模型准入挂载

> 历史子步骤检查记录。2026-10-27范围收敛后，旧服务器接管/旧资金系统相关后续要求作废；当前实现与测试边界见 [清理记录](current-scope-and-cleanup.md)。本文只证明原提交和原测试，不自动覆盖新候选。

日期：2026-10-26。生产启动程序现在可通过程序端 `installModelAdmission(ctx, preparedConfig)` 安装统一费用准入。Host 在模型服务就绪后等待其完成，再构建 Core/Memory/渠道及恢复激活；JSON profile 不能提供该回调或加载路径。原 `onModelCall` 仍只是观测计数，不代替计费。

准入安装失败或中途取消时，Host 关闭已取得 Context 并释放 profile 租约；通过 Context effect 管理的准入资源随之回收。没有该可选程序 hook 的旧 Host 行为保持。服务器运行工厂将负责强制安装真实资金端口；本提交本身不创建资金授权或生产账本。

受管报告 `.runtime/test-reports/5c6a87f0-07f9-4ee5-9102-45307a79d4dd.json`，3/3 通过：

- 异步挂载完成前 Core 尚未构建、agent/model 调用均为零；随后真实本机 Host task 与实际独立 AnalysisRuntime 的 SharedTransport 都经过同一 hook。
- 准入拒绝时，上述两条真实组件链的模型适配器派发均为零。
- 异步挂载抛错，Core 没有构建，挂载资源回收，profile 租约释放；不会留下半启动入口。

测试使用脚本模型与虚构内容，实际运行本机官方 DSH 和项目组件；未连接平台或服务器、没有付费调用。测试通过后受管临时目录已删除。此检查只证明安装次序及两条路径，不宣称共享预算工厂、生产启动或全部辅助模型已验收；后续将逐项验证摘要、交付和子 CLI 的统一预留与结算。
