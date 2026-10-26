# R6f-4 旧记忆按需读取与来源撤回接线

2026-10-27，北京时间。接续 `3dabd63` 读取端；本步把只读服务接到真实 Core 授权和 Memory 来源策略，普通 Host 的固定装配仍待下一子步。

固定扩展 `legacy-memory`、动作 `dafeiyu_legacy_memory_read` 只接受分页参数。实际用户、平台、账号与会话来自当前 Core message origin 的 journal 入站，渠道 since/stamp 由程序端口提供；普通任务、伪造上下文、模型传入 scope/路径/用户字段都不能获得读取权。空页不制造观察来源。

结果是有界历史主张页；Core 对实际页 JSON 生成 capability observation。proof 绑定真实入站、用户/会话、渠道边界、旧文件来源 refs 和页 hash；后续使用重新核验入站未撤回、渠道归属、文件当前版本及每条来源。MemorySourcePolicy 精确识别本动作并保留 `kind:capability`，不退化成笼统 legacy epoch；撤回后的后续模型上下文不再带旧页正文。服务卸载撤销自己的 proof，借用 reader 仍由 Host 关闭。

初轮报告 `b1343d27-2932-4658-9df8-24d4a544763f`：服务 8 项和原 B05 来源合同 5 项，12/13 通过。失败测试把 SDK 在执行前返回的 `INVALID_INPUT` 诊断错误当成 ActionOutcome；核对真实输出和 SQLite 后，改为准确验证 SDK 错误、零操作、零读取、零观察及零 Memory 写入，保留伪造 grant 的独立 `SCOPE_DENIED` 检查。生产实现未为该断言放宽。

报告 `af362b83-41dd-49a0-959f-59d35f91f0b0` 中服务 8/8 通过（同批另有状态测试断言失败）。补齐公开导出并改走包入口后，报告 `3f083df3-4549-49fa-be34-468975007c3b`，服务 8 项及状态 12 项共 20/20 通过。B05 原 5 项已通过，没有无故重跑。

覆盖真正 message grant、页 hash、无源/其它用户空页、参数与任务冒认、文件删除与渠道变代、入站撤回、proof 伪造、服务卸载、后续 prompt 清除、B站与 QQ 分离、分页限额。不自动记录为正式记忆，不采用人格。

证据分类：真实本地 DSH/Core/Memory/SQLite 和文件读取；脚本模型、虚构渠道/旧记忆/时钟。没有读取服务器真实记忆、进行模型或平台调用。所有成功测试目录已受管清理，未影响正式验收材料或原未提交修改。
