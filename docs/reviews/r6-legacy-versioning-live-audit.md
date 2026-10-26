# R6 线上夜间版本流程静态审计

日期：2026-10-26。性质：AI 静态源码审计与接线建议；未运行源码、模型、测试或 Git，未连接服务器，未读取历史库、聊天、记忆正文或凭据。Host executor 存储文件保持冻结；本次仅新增此文档。

## 结论

可以保留现有北京时间 23:00 的“记忆整理 → 归档 → 模型增量日志 → Git”业务顺序及既有历史身份，但不能直接实例化旧 `ScopedBridge`、`NightlyCycle` 或 `HistoryStore` 来获得该能力。旧构造路径包含创建存储、Git 初始化/配置、旧任务恢复；旧人格维护直接写 Markdown，旧会话归档扫描整个旧 DSH sessions 根。上述入口不符合新 Host 的显式存储启用、人格试行/采用边界及重置后记忆保护要求。

最小实现是一个独立的、由新 ManagedHost 固定装配的版本维护服务：保留原 cycle/version/record/import 身份和 Git 提交算法，替换记忆维护端口、会话归档枚举和日志会话装配。无需把旧 QQ 插件或其全局钩子加载进新 Host。该服务尚未实现；不能将本审计表述为 23 点接线或今晚版本已完成。

## 取证截点与精确来源

唯一线上源码材料为 `.runtime/deployment/server-compatibility-source-20261026.json`，本地文件 SHA256：`82f6c7dfc54b200e374167aa95a8594351fffd11cc77f5eaf4d1323f823944e7`。探针观察时间 `2026-10-26T22:47:50.2291349+08:00`，19 个指定文件，原始累计读取 223610 字节；报告标记未执行应用代码、未打开数据库、未读私密数据文件。

下表路径均相对实际 `C:\DSH\DaFeiYu`；SHA256 是探针记录的线上原文件哈希。六份源码均经行级脱敏，`source` 不等于原字节，不能把导出的文本当作可部署镜像。函数位置按 `source` 保留的原行号标注。

| 实际来源 | 原文件 SHA256 | 核对函数/位置 |
| --- | --- | --- |
| `程序/qq-bridge-v073/lib/host-v072.mjs` | `7d33cdfee4ef57ab2b1de78fd14d73f313f2b0e4fdc71bb2c24ba0dc1bdee70c` | `ScopedBridge.constructor` 45；`recordHistory/historyTick` 104/111；`_consolidateMemory` 417；`_consolidatePersona` 457；`fullMemoryMaintenance` 486；`writeVersionNotes` 502；`memoryTick` 524；`apply` 582 |
| `程序/qq-bridge-v073/lib/nightly-cycle.mjs` | `18a2350cc6df0027dc246ae9b2755d06e4296104c11bee0966435f5a56049c63` | `constructor` 6；`request` 7；`tick` 14；`status` 49 |
| `程序/qq-bridge-v073/lib/version-manager.mjs` | `29d35216c830e749bce86f17d364d435a52d2b2a03edee8b21a093be0c7b2855` | `dueDay` 7；`protectedPath` 13；`initialize` 23；`acquire/release` 30/37；`prepare` 40；`evidence` 63；`saveNotes` 71；`finish` 78 |
| `程序/qq-bridge-v073/lib/history-store.mjs` | `7d7ed5ff3d939362b4bfea96b3f07abe8d78ffd2a6cde2c1519980f902b9df7c` | `sha/decodeSessionFrames` 7/8；schema 42–60；`append` 65；`storeSnapshot` 89；`saveCycle/version/putVersion/stats/range` 104–109；`ingestSessions` 114 |
| `程序/qq-bridge-v073/lib/persona-memory.mjs` | `8965ceb0709d25af055cb02c3019beb629973adf6807c6c8cb5259c2b2aacd2c` | `read/snapshot/context` 11/18/19；`pending/observe` 26/27；`commit` 37 |
| `程序/qq-bridge-v073/lib/shared-memory.mjs` | `7255403ed9e5e8c27a3aeed664673c26466e6e1b15f9b7973010293823a8f8d8` | `documents` 41；`snapshot` 61；`commit` 76；`context` 116；`visibleFacts` 29；`withdraw` 148 |

公开配置依据：`配置文件/bridge.json` 哈希 `15ef10e74fea624982d49e2ff51eb86f5d9fab1cade79d54f86336d7d3e168a8`，投影显示 `versioning.enabled=true`、`firstDay=2026-10-22`、23:00；`配置文件/layout.json` 哈希 `b9be2d47ff410d82a91f24d2c3a81b8a08d5f2de5843644dba4b1bbd4a03311d`。QQ 包声明版本 `0.7.7-dafeiyu.1`，入口确为文件名仍含 v072 的 `lib/host-v072.mjs`；包文件哈希 `0cb9101521b768a3f69ffe32aee36bf3878e7bfe352848657531add302327ec8`。不能据旧文件名回退版本。

## 当前真实代码顺序

1. `apply` 每 4 秒调 `memoryTick`；它先检查独立 update-guard 的 `maintenancePaused`，串行化 `memoryBusy`，最后调 `nightly.tick`。旧 `historyTick` 另每至少 60 秒跑一次，不在此 guard 判断内。
2. `dueDay` 用 UTC+8，23:00 前返回前一日，且不早于原 `firstDay`。每日 ID 是 `daily-YYYY-MM-DD`；已 `complete` 即返回。`request.json` 可优先指定 manual/bootstrap，不能把支持 bootstrap 理解为允许日常重跑初始化。
3. `NightlyCycle.tick` 待旧会话/服务器任务/人格维护空闲，获取 `运行状态/versioning/version.lock`；保存 attempts、phase、retryAt。维护未完成保存 `memory_pending`，30 秒后续跑；异常保存 failed，10 分钟后重试。
4. `fullMemoryMaintenance` 处理 persona-evidence 每批最多 40 条、单次最多 10 批，再处理待变化用户、每用户最多 5 批；数量是单次分页，不是恢复已取消的总调用次数上限。剩余候选或有活动任务时 `complete=false`。
5. 维护完成后 `ingestSessions`；归档报错会阻止日志/Git。`prepare` 固定 base HEAD、临时 Git index/tree、diff、维护事实、归档 `after/through` 水位和共享记忆文件快照；同 version ID 已存在则复用。
6. `writeVersionNotes` 新建官方 DSH Agent，仅开放 `read_version_evidence`、`commit_version_notes`；输入以改动、统计、维护结果和来源索引为主，不把记忆正文送入日志。源码固定 `deepseek-flash`，新 Host 应改用受信路由与统一预算，不能另开未计费模型支路。
7. `finish` 要求已有 notes；以临时 index 建提交，`update-ref HEAD <new> <base>` 比较交换；已提交或已在 HEAD 祖先链时不重复。仅正常 index 原先干净且哈希未变时同步它。随后保存 Git 文件快照、version committed，再保存 cycle complete。HEAD 变化产生新的 version attempt，不回退 HEAD。

## 必须保留的状态与真实记忆

| 状态 | 接入约束 |
| --- | --- |
| `历史记录/history.sqlite` 与 `.initialized` | 原地保留全部 records/imports/cycles/versions/blobs/snapshots 及原 ID、hash。先备份与验证，再以“必须存在”模式打开；缺库/截断/schema 不符即停止，不调用旧建库构造函数补空库。已有 schema 为源码支持的 v1；线上实际 schema/行数本次未读。 |
| daily/manual cycle | 保留 day、kind、attempts、retryAt、memoryDone、memoryPasses、maintenance、versionId、versionAttempt、commit/version 引用。已完成的日期不重跑；未完成的按原冻结阶段续跑，不能重命名 cycle 绕过唯一约束。 |
| prepared/commit_prepared version | 保留 base_commit、tree_id、notes、plan.index、normalHash/cleanIndex、commit_hash。已冻结计划不掺入切换后的新事件；新事件归下一次增量。缺临时 index 或证据不能声称已完成，也不能覆盖旧 version。 |
| 归档水位 | `records.id/source_key/hash`、`imports.source/fingerprint`、每版 `plan.recordHighWatermark` 原义不变。后者来自前一已提交版到当前 max(records.id)，不是“全体记忆已整理”的证明。不得归零或修改既有 key 算法。 |
| 重置边界 | `运行状态/qq-bridge/state.json` 的 resetAt、processedByRoute、routes/sent，以及实际群 since 边界均保留。当前值未知，部署端需只取必要元数据。没有 resetAt 时不能默认 0 恢复旧记录，也不能默认现在而丢掉重置后的真实记录。 |
| 人格与共享记忆 | 保留 layout 指向的固定核心、规则、`共享记忆库/人格记忆/02_可更新偏好.md`、`03_近期状态和关系记忆.md`、users JSON，以及 persona-evidence 的 events/processed/lastMaintenanceAt、candidate_versions/candidate_signature、原 route/user/source/time。不得用本地初始化快照替换；不恢复已清除旧档案。 |
| 旧 pending/outbox/游标 | 保留 history-outbox、维护结果、persona pending、用户候选、HistoryDigest 游标与各来源身份；本轮未读取内容。只有证明属于重置后且尚未处理的项目事实，才进入新管道。存在文件不等于授权重放。 |

旧 `memoryDone=true` 只表示旧流程的一次维护已完成，不升级为新经验已复核、人格已试行或采用。兼容接线的新阶段/来源映射记录建议放独立 sidecar，引用原 cycle/version，不回填重写旧完成记录、旧 7C 账本或新人格 schema。

## 最小模块与接线边界

建议固定 `LegacyVersioningService`，只接受部署程序提供的明确 root/profile/路径/hash 与以下程序端口；不接受模型提供的路径、Git 参数、watermark 或“已完成”布尔值：

| 端口 | 最小职责 |
| --- | --- |
| `ExistingVersionArchive` | 必须存在地打开旧 history v1；复用 append 的 source-key/hash 幂等语义和 cycle/version 记录。新增 Host 记录使用独立来源命名空间；旧记录不改 key、不补造来源。 |
| `MaintenanceBarrier.run(cycleId, cutoff, signal)` | 经新 Memory/Activity/Core 的真实授权 Run 处理冻结范围，返回持久 receipt refs、剩余数量、来源水位和 owned session IDs。只有覆盖该范围并有持久结果才 complete；失败/取消/unknown 保留。 |
| `OwnedArchive.flush(cutoff, sessionRefs)` | 先 flush 真实持久化，再只读项目已持有的具体 session/event IDs；脱敏并丢弃 thinking/reasoning，按当前可见范围追加到历史库。返回真实 archive through；不扫描父 DSH 整根。 |
| `VersionNotes.author(frozenPlan, signal)` | 在新 Host 的官方 DSH 组件中运行专属受限任务，工具仅为 frozen evidence 分页及 notes 保存；统一模型路由、预算与 cancellation。不得混入聊天发送、旧 persona commit 或通用 executor。 |
| `VersionGit` | 固定仓库/受信 Git 可执行文件，检查既有 root 身份；复用临时 index、冻结 tree、commit-tree、HEAD CAS 与正常 index 哈希保护。程序在日志持久回执后调用，模型不执行 Git。 |

新 Host 当前的 `MaintenanceService.schedulingPort()` 仅有 ready/pending/inspect/coalesce/settleMetadata/connect；契约明确它不携带读取或执行权限，且 `connect` 拒绝第二 scheduler。因此不能把它直接当“整理完成”端口，也不能再挂一个竞争的 Activity 消费者。最小补点是复用已连接 Activity 的授权调度，增加冻结范围的 barrier/receipt 汇总；`settleMetadata` 或 pending 为空本身不证明真实分析成功。

新 Host 也尚无公开的“暂停准入但保留服务、完成维护后恢复”接口；现有 `close` 会关闭资源。版本服务需要明确的程序级维护窗口或固定事件截止点，不能靠 `snapshot().activeRuns===0` 假装获得互斥。保留独立 update-guard/maintenance，协调项目入站、任务、交付、Activity 与版本窗口；不停止或卸载官方 DSH 基础服务。

旧用户记忆和关系需要保留可用性：先保留原文件，通过受 scope/reset 边界约束的只读 legacy resource 暴露给合法会话；作为来源事实/历史主张，不直接登记成新 adopted 人格。若要纳入新可变记忆，单独做带来源映射的显式迁移，逐条保留来源和撤回语义。后续人格变更只能走新 propose/review/trial/outcome/adoption/publish；不能保留 `commit_persona_memory` Markdown 写回旁路。

旧 `VersionManager.prepare` 只收集共享记忆根的 md/json，无法代表新 SQLite Memory 的完整快照。应由新 Memory 的受信快照端口产生明确的私有归档及哈希清单，连同旧文件快照保留在受保护存储；日志只接收数量、机制和 refs。不得把 SQLite 二进制交给旧 `storeSnapshot(kind='memory')` 的 UTF-8 文本脱敏路径，也不得把新运行库加入 Git。

## 可复用逻辑与必须替换的实现

- 可单独提取并测试的纯逻辑：`dueDay` 的 UTC+8 日界线；`protectedPath` 的路径分类；`sha`；`decodeSessionFrames` 的 frame 边界算法（新适配器另加压缩/解压总量上限）；`SharedMemory.visibleFacts(profile,route)` 的同源过滤。提取逻辑不等于直接导入脱敏文件。
- `PersonaMemory.read` 的记录块解析、共享候选 ID/version 派生可保留为只读兼容解析规则；其 FS 读取、context 和 snapshot 方法本身不是纯函数。保留旧 ID，不用新随机 ID 重写已处理水位。
- `NightlyCycle` 的有序 phase/retry、`VersionManager` 的冻结计划与 Git CAS、`HistoryStore` 的事务/唯一索引是可复用的有状态算法；必须改为显式依赖和 existing-only 打开，不能称其为纯 helper。
- 必须替换：`NightlyCycle.constructor → manager.initialize`；`HistoryStore` constructor 的 DDL/marker 写入；`ScopedBridge` constructor 的旧 task recover；`_consolidatePersona → PersonaMemory.commit`；`SharedMemory.commit/withdraw` 对旧 JSON 的写入；整根 `ingestSessions`；旧裸 `ctx.agents.create` 的维护/日志装配。
- 尤其 `ingestSessions` 114–143 仅按两个旧 home 的 `.jsonl.zstd` 扫描和 size/mtime fingerprint 跳过，既没有 resetAt 过滤也不是新 Host 的 owned sessions 清单。不能通过清空 imports 来“补齐”，不能只更换根路径后全扫。新导入使用明确项目 session ID、持久 event identity/seq 和内容哈希；原 imports 水位保持原义。
- `protectedPath` 阻止旧运行/历史/共享记忆、凭据、node_modules 等；新增 Host 数据根可能不在旧前缀内，须加入部署固定保护路径并校验 Git 跟踪/暂存清单。旧 `prepare` 的 `git add -A .` 不能在未核对新路径保护前复用。正常 Git dirty 状态与用户暂存内容必须保留。

## 最小实施顺序与尚欠证明

1. 部署前只取必要现状元数据：原 cycle/version 阶段、冻结 plan/commit/head/index 指纹、recordHighWatermark、imports 游标、resetAt 和项目来源列表；在服务器原位备份既有历史与记忆，私密内容不拉回本地。确认无 active update/旧版本周期，或明确继续其冻结阶段。
2. 显式启用新模块的 sidecar/配置；校验既有 history schema/root/Git 身份，缺失即拒绝启动。禁止调用 Init/Cutover/Finalize/Retry 或创建 bootstrap 请求来获得“首次成功”。
3. 切换时只关闭旧项目的 nightly/history/persona 写入口并排空其在途工作，保留基础组件、独立守护和所有实际数据；新模块取得同一版本职责的排他所有权后开始按原日历判断。不得双 writer，也不能留下旧 `historyTick` 仍扫描整根。
4. 新维护 barrier → 项目归档 → 冻结版计划/私有快照 → 受限日志 Run → Git CAS → history version/cycle 完成。既有 prepared 计划先原样续完；后来的新事实进入下一增量。日志或 Git 失败保留原阶段，不回滚当前真实记忆。
5. 先做虚构数据定向验证：跨 23 点及重启幂等、memory_pending、HEAD 改变、commit_prepared 恢复、dirty index 保护、旧完成 cycle 不重跑、missing history 拒绝、reset 前记录不重导、scope/撤回、维护失败与无预算阻断、两 writer 冲突、真实新增记忆字节保留。之后线上验证只证明实际发生的那一轮，不能提前宣称夜间保存。

证据限制：NightlyCycle 第 32 行、VersionManager 第 39/104 行、HistoryStore 的 constructor/append-key/ingest-key 等关键行被探针整体脱敏；可见调用支持上述顺序，但不足以证明 `assertSafe` 全部策略、原 key 公式和所有完成后归档动作。当前没有运行中的 cycle、Git HEAD 或私有水位数据，亦未读取 `bridge-core(-v072)`、`HistoryDigest` 等完整依赖。最小后续是对这些缺失部分做限定的公开源码/元数据核验或采用经测试的显式适配实现，不再抓取整套私有数据或广扫目录。
