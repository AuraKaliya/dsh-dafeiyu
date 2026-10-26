# R6 B站主人渠道：Host 存储装配

2026-10-26。依据根代理已确认的 R6f 接管细案与本步收敛决定实现。本记录只描述本地代码和待运行测试，不是服务器迁移、私信接管或交付验收。

## 文件与数据边界

修改仅限 Host 的 `profile.ts`、`storage-inspection.ts`、`migration.ts`、`cli.ts`；新增 `tests/host-bili-owner-storage.test.ts`。configuration/runtime/status、Host package/根 lock 与 tsconfig 由根代理装配，本步未修改。

新库固定为 `config.paths.core/bili-owner.sqlite`，与 bilibili.sqlite/executor.sqlite 并列；StorageKind 与 manifest.requiredStores 名称均为 `bili-owner`。没有新增 paths.channels、HostResource 或资源布局索引，旧 manifest.paths 保持原义。

使用渠道包公开的 schema/application ID/TABLES、固定 UID、identity schema、Store、initializer 和 readonly inspector；没有复制其 schema DDL。Host 检查只打开 readonly SQLite，没有构造渠道 Service、transport 或恢复任务。

## 三个明确阶段

1. **显式建 schema。** 新空 profile 的 `initializeProfile` 创建渠道 schema 并把 requiredStores 写入 manifest；since 仍为 null，handover/inbound/events 为空。初始化不读取旧 dm-worker.json、不补部署时间、不导入旧私信、不认领 queue。
2. **旧 profile 显式迁移并绑定。** `MigrationBundle` 新增 optional `biliOwner`，不默认补 false。启用插件或库已存在时，计划纳入该库。缺库仅在显式 apply 时创建 schema；已有 v1 只读检查和备份，apply 不 reopen Store、不调用 recover、不把 sending 自动改为 unknown。完成备份/验证后才绑定 requiredStores。
3. **独立受信交接。** schema 与 manifest 完成仍不代表可运行；只有另行执行经过真实来源核验的 fresh/legacy handover，渠道才可能就绪。启用插件但缺 handover 时 inspect 给 `HOST_BILI_OWNER_HANDOVER_REQUIRED`，ready=false，普通 Host.start 的既有预检拒绝启动。

CLI `migrate apply` 在成功后，仅对启用了 channel-bili-owner 的配置立即调用 bindMigratedProfile，再输出完成结果；不改变未启用该插件时其它插件原有的 CLI bind 行为。

直接 API 调用者须遵循同一顺序：

```text
planMigration({ ..., biliOwner: true })
→ applyMigration(plan)
→ verifyMigration(plan)
→ bindMigratedProfile(config)
→ 单独受信 handover
→ inspectHost(config)
```

这不要求伪造交接以“通过迁移”，也不降低原行检查。已有 v1 在 handover 后改变了原冻结行，其旧 plan 的逐行 verify 会如实失败；这是该快照已不再等于当前事实，不是许可重置数据。正确顺序提前绑定已完成的 schema 迁移，后续普通启动依据当前 schema/identity/handover 检查，不重复套用旧冻结行快照。新库尚未导入时 sourceReady 仍 false，没有接收旧消息的旁路。

## 备份、恢复和停用

- 可选字段缺省保持缺省；旧 plan 解析不增加 biliOwner 或额外快照属性，原 JSON 内容 hash 不回填。实际实现变化仍受既有 engineHash 防护，不伪造旧引擎兼容，不绕过 MIGRATION_CODE_CHANGED。
- 新计划把渠道包编译实现纳入 engineHash。备份文件沿既有 `<backup>/<planId>/<index>-bili-owner.sqlite` 命名；保存现有 handover 原文/hash、seen tombstones、held/claimed-unknown、Core 绑定、所有交付与 poll 水位。
- verify 对含 bili-owner 的计划额外返回 `biliOwnerEvidencePreserved`。它核对原来源行及全部原有库的备份 schema/identity/integrity/逻辑行，缺损备份不能作为新增 requiredStores 的依据。备份中的历史 owner PID 不是备份文件的真实运行占用，不借其判断活跃实例。
- apply 中断后只允许续用已经建好的、尚无 handover/入站/交付/事件的 schema 空库；不覆盖已出现的业务事实。此前所有行检查、会话快照检查和失败留备份行为保留。
- 停用插件不会删库或移除已有 requiredStores；现存库仍接受 metadata/integrity 检查并被后续 migration 纳入，即使 bundle.biliOwner 缺省。停用时不要求业务 handover 完成，避免把未启用渠道的运行门槛套到其它 Host 功能；已经绑定的库丢失仍由 requiredStores 拒绝。
- 无新的临时/父 DSH 根备份范围，无旧 worker 读取/初始化，没有 Git 操作、模型或平台接口。迁移仍要求原 Host 维护窗口和资源占用检查，不能把一行旧 sending 状态推断为当前有/无网络进程。

SQLite backup 保留已提交逻辑数据，不承诺副本 page bytes 等于有 WAL 的源 main 文件；readonly 检查可能维护 WAL/SHM 辅助文件。本步已有 v1 分支不执行 configureSqlite/域恢复，测试额外核对关闭后的源 main bytes 未改。

## 待运行定向测试

`tests/host-bili-owner-storage.test.ts` 共 8 项，使用 D 盘受管虚构 SQLite：

1. 新 init 仅 schema，缺 handover 阻止 ready，独立 handover 后放行，layout不变。
2. 旧 profile 增量启用、备份、schema 创建后中断/续跑、先 bind 后 handover，旧 memory 行保留。
3. 已有空 v1 的同顺序接管；handover 后旧冻结行 verify 仍严格，不降低校验。
4. legacy queue/seen/since/精确大整数、unknown 与 sending 的原行和源字节保留，副本一致；停用后仍保留并纳入计划。
5. 错身份和未知 schema 只读拒绝，不修复原字节。
6. 原有库备份损坏时，即便新 schema 有效也拒绝 manifest 绑定。
7. 旧 plan 可选字段与内容 hash、旧配置 hash、manifest bytes/资源布局兼容。
8. 实际 CLI migrate apply 自动完成 schema 绑定，但 since/handover/入站仍为空且启动门槛关闭。

测试中的 fresh cutover hash、legacy queue、Core UUID 和发送状态均为程序虚构，不代表真实平台入站或发送。当前未自跑 build/test/Git/server；由根代理统一构建、定向执行与受管清理，结果后补。
