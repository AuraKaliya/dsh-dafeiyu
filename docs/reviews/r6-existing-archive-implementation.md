# R6f-1：existing-only 历史适配器实现记录

2026-10-26。依据已提交 `docs/server-runtime-r6f-plan.md`（9696b7c）。本步是本地实现与待运行测试，不是线上历史库验收、后台周期完成或真实模型日志证明。

## 文件与边界

新增独立 `packages/server-compat/`：package/tsconfig、`src/safety.ts`、`schema.ts`、`archive.ts`、`index.ts`。新增 `tests/server-existing-archive.test.ts` 与独立虚构 SQLite fixture。没有修改根 tsconfig/lock、Host、旧线上镜像、7C 账本或其他业务文件；构建、测试和 Git 提交由主代理统一执行。

该包仅依赖 contracts 的公共脱敏函数及 Zod，没有 DSH runtime、旧构造器、Git、模型、网络、定时器或后台恢复入口。它不创建目录、数据库、marker、表、索引或触发器，也不改变 journal_mode/user_version。没有泛用 SQL、模型查询工具或跨会话搜索 API。

## 公开 API

```ts
inspectExistingArchive({ root, database }): ArchiveInspection
openExistingArchive({ root, database }, { profileId, knownSecrets?, clock? }): ExistingArchive
```

`database` 必须是已存在的实际 `root/历史记录/history.sqlite`；root、历史目录和文件均要求规范真实路径，拒绝符号链接/junction，数据库也拒绝多 hardlink。每层 dev/ino 使用 BigInt 读取后输出十进制字符串，绝不经 Number 截断。inspect 不返回历史正文，只返回 ready/code、schemaHash 和文件身份。

显式 writable open 先用独立 readOnly 连接完成预检，再以 SQLite URI `mode=rw` 打开并在 `BEGIN IMMEDIATE` 内重验身份/schema。每次写入前、事务内和提交前重验；只读方法亦核对。缺库时不会依赖 `existsSync` 后的可创建默认打开。

已核实 [Node v24.13.0 官方源码](https://raw.githubusercontent.com/nodejs/node/v24.13.0/src/node_sqlite.cc)：`ValidateDatabasePath` 对字符串保留原文，`DatabaseSync::Open` 添加 `SQLITE_OPEN_URI`。[SQLite URI 定义](https://www.sqlite.org/uri.html) 区分 `rw` 与允许创建的 `rwc`。实现传 `pathToFileURL(...).href` 加 `mode=rw` 的字符串；另有受管实际 Node 契约测试验证“不存在即失败”。这不是针对 Administrator 恶意 TOCTOU 的不可绕过保证；生产仍须明确的单写者接管窗口。

对象方法：

| 方法 | 语义 |
| --- | --- |
| `appendHostRecord(record)` | 自动构造 `host:<profileId>:<id>`。kind、来源 id/hash、可见性及 `{type,data}` envelope 均白名单校验；同来源完整内容一致返回同 id/hash、created=false，正文或元数据变化拒绝。 |
| `range(after = '0')` | 只给记录种类计数和真实 after/through，不读取历史正文。水位和计数使用十进制字符串；不接受超过当前记录高水位的 after。 |
| `getCycle(id)` / `getVersion(id)` | 程序可读冻结快照和完整行 token，保留未知 JSON 字段；没有为模型开放。 |
| `createCycle({id,day,kind})` | 仅新 daily/manual，初始 waiting；daily ID 必须匹配日期，同身份重复返回原记录。不会新建 bootstrap，不改旧完成周期。 |
| `transitionCycle({id,expectedToken,state,patch?})` | 事务内比较完整行摘要，按有限状态顺序更新已知字段，保留未知字段/额外列。拒绝 attempts/versionAttempt/memoryDone 回退和提前写入 commit/finished 信息。 |
| `prepareVersion({id,cycleId,expectedCycleToken,baseCommit,treeId,plan})` | 仅 writing_notes 周期且维护已完成；计划冻结、同内容重入幂等。新 recordHighWatermark 不超过当前记录上界且不倒退已提交版水位。 |
| `saveVersionNotes({id,expectedToken,title,notes,evidenceRefs,run})` | 仅 prepared → notes_ready，周期须 writing_notes；引用必须来自冻结计划。日志和一条 Host notes 来源记录在同一事务保存。 |
| `markCommitPrepared({id,expectedToken,treeId,commitHash})` | 仅 notes_ready → commit_prepared；周期须 committing，已有 notes。允许在此阶段记录加入日志后的最终 tree。 |
| `markCommitted({id,expectedToken,commitHash})` | 仅 commit_prepared → committed；commitHash 必须匹配已准备值。它存储调用方实际 Git CAS 结果，不执行 Git。 |
| `close()` | 关闭本实例连接，可重复调用；不停止其他进程。 |

`saveVersionNotes.run` 是 `{runId,closedEventId,resultHash}` 的持久来源引用，不是执行授权；上层版本服务必须核验真实已闭合 Run、结果及预算。`markCommitted` 同样要求上层已经验证真实 Git 操作。适配器不自行生成成功内容、假模型日志或后台完成事实。

## schema 与原数据保护

- 只接受 user_version=1，检查 records/imports/cycles/versions/blobs/snapshots/records_search 必需列，以及 records 的独立 INTEGER PRIMARY KEY。
- 核对 source_key、各主键和 snapshots 复合唯一约束；严格核对每日 cycle 的 `kind='daily'`、每 cycle 已提交版本的 `state='committed'` 部分唯一条件，保留字符串大小写语义。
- records 更新/删除触发器必须是无条件 `BEFORE UPDATE/DELETE ... RAISE(ABORT,...)`；不能只凭名称存在放行。校验已知 records_index 的插入结构，拒绝这些权威表上的额外未知 trigger。
- FTS 创建语句在实际探针中被脱敏。本实现只确认 records_search 存在、body/rowid 可用及已知 records_index 接线，不猜 tokenizer、content 参数或虚表实现，不执行修复 DDL。测试用普通搜索表替身，不能称为线上 FTS 验收。
- 验证 snapshots → blobs 外键、quick_check/foreign_key_check。完整 sqlite_master 指纹绑定连接；打开后 schema 改变即拒绝后续操作。
- CAS 使用所有原 SQL 列的 token，并在 BEGIN IMMEDIATE 中重读；JSON patch 只覆盖声明字段。未知 payload/plan 字段、额外列、未涉及行原样保留。已 complete cycle、已 committed version 拒绝回写。
- imports、原 source_key/hash、历史版本水位、blobs/snapshots 都没有更新/清理接口。没有整根 sessions 扫描、resetAt 初始化或已清除历史重建。只读 SQLite 可能维护 WAL/SHM 辅助文件；不把这种文件系统行为误报成应用行更新。

## 可见内容边界

新记录的 type 只允许 user/assistant message、tool call/result、turn start/end、compaction 及明确维护/版本/迁移事件；没有 request/context、裸 stdout/stderr 或 rawlogs envelope。递归删除 reasoning/thinking/chain-of-thought/stream/replay/signature 字段和相应内容块，屏蔽凭据键、常见秘密模式和部署程序注入的已知秘密。来源/route/actor 等元数据若需要脱敏则直接拒绝。

这是结构过滤和已知秘密脱敏，不是对所有私人自然语言的检测器。调用方须基于真实来源决定 owner/conversation 归档范围；adapter 的 program-only 方法不代替 Core 来源授权。既有记录不会为了新规则被重新脱敏或改写。

## 待运行验证

定向文件 `tests/server-existing-archive.test.ts`，共 10 项：

1. 实际 Node SQLite URI rw 缺文件拒绝，且无数据库/marker/Git 创建。
2. readonly inspect、显式 open/close 保留旧行、原 main bytes、marker 和无关脏文件。
3. 错误路径、未知 schema、同名伪不可变 trigger 拒绝且不修复。
4. 部分唯一条件和 search 必需列核验；不推定真实 FTS 定义。
5. junction 真实路径别名拒绝。
6. 私有块丢弃、秘密脱敏、Host key 幂等和元数据/正文冲突。
7. 两个真实 SQLite 连接的 CAS 冲突；未知 JSON/额外列保留，原 records trigger 生效。
8. 从冻结计划到日志、commit_prepared、committed、cycle complete 的顺序；原行/水位保留且终态拒写。
9. 维护失败/未完成不得跳阶段，旧完成周期不可重跑。
10. 打开后删除保护触发器会阻断追加，不自动重建。

这些测试仅验证虚构存储与程序引用，不启动模型、Git 或服务器，不把虚构 commit/run ID 解释为真实效果。当前尚未运行；未产生测试报告。所有 fixture 通过现有 `testTempDir()` 放在 D 盘受管目录，由根测试入口统一清理。

实际服务器的完整 schema 元数据、当前 cycle/version、水位、resetAt、唯一写者与切换时点仍待部署阶段核验。本步不提供 23 点调度、维护 barrier、Git 执行或新旧消费者切换；它提供这些步骤可使用的既有持久层边界。
