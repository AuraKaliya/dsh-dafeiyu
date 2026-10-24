# 第一阶段1C：Run账本、数据预检与迁移

日期：2026-10-24。接续1B提交`8968d54`，工作分支`phase-1-core-host`。本步只在新建的虚构数据目录测试，未连接服务器、未操作既有QQ实例或真实记忆库。

## 实现

| 数据／模块 | 本步结果 |
|---|---|
| runtime.sqlite v1 | 显式初始化、agent/profile身份、单宿主占用；请求去重、Task绑定、Run状态／快照、操作事实、检查点、唤醒回执与outbox |
| journal v1→v2 | 新Task事件的独立可见范围；旧conversation查询不返回Task事件；原消息／事件／seq保持 |
| memory v6→v7 | 仅新增执行范围／来源／观察、成长选择、Run结果及独立outbox表；旧记录、边界、哈希、删除和任务状态不重写 |
| @dafeiyu/host | 新增存储预检和迁移协调模块；正式Host启动／模型运行入口尚未实现 |
| 迁移CLI | 独立plan／apply／verify；配置指纹、代码指纹、Node／SQLite版本、数据路径及源行摘要绑定；活动宿主、未知库、代码或源数据变化时拒绝 |

runtime不保存第二份完整聊天历史，Task定义继续在原仓储；结果只绑定DSH位置和正文哈希。快照与结果不可覆盖，running中断后转interrupted，未确认操作转unknown，迟到确认不能直接把未知状态提升为成功。取消或完成时有尚未结束的操作会被拒绝，避免伪称全部完成。

唤醒回执和Run在同一事务提交；outbox写入失败时不会留下半个已受理Run。跨memory／runtime创建Task的持久请求入口已具备，真正的运行协调和权限签发在1D接入。

## 迁移保护与恢复

只读预检不调用会自动迁移的Service构造器。迁移先确认所有相关存储无活动宿主，取得独立迁移占用，再用SQLite backup保存一致性快照及DSH持久文件副本。模型、工具和渠道在本步从未启动。

迁移manifest记录逐库进度；core目录另有migration-state标记。中途失败保留备份和不完整标记，按同一计划核验原行摘要／备份后继续向前；不会自动把旧快照覆盖到新数据上。后续Host需用这些状态阻止未完成迁移期间的启动。

已经完成的计划再次apply只核验当前目标结构／身份，不再执行迁移，也不会恢复旧墓碑、旧记忆或发送状态。首次apply同时验证旧业务行及会话文件不变；后续verify是结构／身份健康核验，不宣称可以据此证明所有业务内容永远没有变化。

源码历史核对发现：`v0.2.0`的journal v1尚无analysis_grants表。现在明确识别这个已知早期格式，在升级中补表；不把它误判成损坏，也不接受任意未知表结构。

memory旧格式夹具继续使用原有冻结SQL和数据。模拟降级测试增加了移除v7附加表的步骤，且原边界迁移的计数断言改为限定version=2；另行验证version=7只有一条记录。原隔离、删除、哈希和并发断言没有放宽。

全量检查曾暴露WAL模式切换的并发锁错误：该PRAGMA有时会立即返回BUSY，未按既有busy_timeout等待。现在仅对这个初始化步骤在原5000ms预算内重试，并增加持有真实旧库读锁的测试；没有提高旧测试超时。Journal的新库创建还在事务内重新核对状态，防止两个并发构造器把已升至v2的库降回v1。

首次绑定旧库时核对现有agentId；已有runtime严格匹配agent/profile。旧库没有profile元数据时使用本次明确配置作首次绑定，不按文件夹名字猜测身份。完成后的重复apply不会把后来新增的合法删除回退。

## 验收与复现

新增Runtime与迁移专项使用真实SQLite、虚构旧记录和故障注入，不是实际模型／平台验收。覆盖身份与占用、快照／结果绑定、操作未知状态、幂等与冲突、唤醒事务回滚、Task事件不可被旧会话查询、旧v1数据保留、多库中断续接、路径越界／代码变更拒绝、完成后新增删除不被备份覆盖。

最终全量检查：**452项通过，0失败、0跳过**；迁移CLI演示5项检查全部通过。本步没有新的真实模型调用。Git差异检查对本步暂存文件通过；全工作区检查仅报告用户原有`docs/memory-phase-1.md:22`末尾空白，该文件未修改／暂存，SHA256仍为`CB9A2383531A39461C50D7CA8F58C6C1879CF12A0A0DAFDF8CFA5B387911F730`。

```powershell
npm.cmd test
npm.cmd run demo:migration

# 以下命令操作明确选择的本地数据；plan只读，apply会迁移。
node scripts/migrate-profile.mjs plan --config <host-config.json> --backup-dir <backup-directory> --out <new-plan.json>
node scripts/migrate-profile.mjs apply --config <same-host-config.json> --plan <new-plan.json>
node scripts/migrate-profile.mjs verify --plan <new-plan.json>
```

迁移演示通过CLI创建并升级独立虚构旧库，结果见[1C演示记录](results/phase1c-storage.json)。报告中的sourceRevision为提交前基线，engineHash对应实际构建产物，dirty字段如实保留。演示会话文件是合成JSONL字节，只验证备份保留，没有冒充完整DSH历史回放验收。

本阶段不改变delivery、analysis、working、feedback或QQ的数据格式；备份已有权威侧库但不重跑其恢复工作。检索与查询缓存是可重建派生数据，不作为权威迁移来源。真实运行实例的数据切换、完整DSH恢复和服务器组合仍在后续阶段验收。
