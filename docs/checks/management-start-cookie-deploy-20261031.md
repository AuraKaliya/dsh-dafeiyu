# 管理中心启动修复与B站 Cookie：部署与回退步骤

日期：2026-10-31。适用包：

- A：`D:\DSH\DaFeiYu-Local\deployment\packages\dsh-dafeiyu-0.25.2-management-start-20261031`（B站库仍为 v5，运行库 v2）
- B：`D:\DSH\DaFeiYu-Local\deployment\packages\dsh-dafeiyu-0.26.0-management-cookie-20261031`（B站库 v6，运行库 v2）

本文是**可执行清单**，不在本轮自动执行。每一步都应先核对路径，再执行；破坏性操作前先备份。

## 0. 只读预检（切换前、重启后都先跑）

仓库内提供只读检查器，不会停止/启动/切换/写入任何东西：

```powershell
# 切换前：当前应当是 0.25.1 + v5；只报告，不要求 ready
node scripts/verify-local-deploy.mjs --expect-bilibili 5

# 切到 A 并重启后：应当 ready:true
node scripts/verify-local-deploy.mjs --expect-version 0.25.2 --expect-bilibili 5 --expect-runtime 2 --backup D:\DSH\DaFeiYu-Local\backups\before-management-cookie-20261031

# 切到 B、迁移并重启后：应当 ready:true，且 client bundle 含验证面板
node scripts/verify-local-deploy.mjs --expect-version 0.26.0 --expect-bilibili 6 --expect-runtime 2 --backup D:\DSH\DaFeiYu-Local\backups\before-management-cookie-20261031
```

检查项：profile 的 `dsh-dafeiyu` 链接与已安装链接是否指向同一包、`release.json` 版本/修订、`client.js` 是否包含对应面板、`cordis.patch.yml` 的 settingsFile、配置是否可读、数据目录、`host-status.json` 的 phase/PID/存活、B站库与运行库版本、备份目录。失败时以稳定错误码输出，不打印凭据路径或内容。

> 说明：`host-status.json` 的读取 schema 在 0.26.0 修复了与真实写入不一致的问题（B站 `diagnostic` 字段、存储版本漂移），否则旧快照会被误判为 `HOST_STATUS_INVALID`。A 0.25.2 沿用 0.25.1 的该读取器，但本预检脚本直接读取状态文件，A 阶段的预检与中心页 IPC 快照不受影响；A 阶段不要依赖 `dafeiyu status` 读取该文件。

## 0. 前提与安全边界

- 当前正在运行的实例（PID 11324，自 `dsh-dafeiyu-0.25.1-reading-20261031`）由 DSH Desktop 的 profile 加载。切换包后必须重启 DSH Desktop 才能加载新插件代码。
- 不要同时运行两个版本的实例；不要只改 profile 链接而不停实例。
- 凭据文件保持原位，不复制进发布包、不写入报告、不通过聊天传输。
- 方案第 1 节要求：未得到明确授权前，不修改正式配置、不读取真实凭据、不解除暂停、不重启实例。以下步骤需在用户确认的维护窗口执行。

## 1. 备份（A/B 两步都做）

建议备份根：`D:\DSH\DaFeiYu-Local\backups\before-management-cookie-20261031\`

1. 记录现状：
   - DSH Desktop 进程与 `dafeiyu.mjs` 子进程 PID、命令行；
   - `~/.dsh/profiles/desktop/package.json` 中 `dsh-dafeiyu` 的实际链接目标；
   - `data\core\host-status.json` 的 `phase/pid/accepting`；
   - `bilibili.sqlite` 的 `PRAGMA user_version` 与 `PRAGMA application_id`。
2. 停实例：通过管理中心「停止实例」等待进程真正退出；确认 `host-status.json` 变为 `stopped` 且实例占用释放。不要按进程名批量结束。
3. 备份：
   - `D:\DSH\DaFeiYu-Local\configuration\` 整目录；
   - `D:\DSH\DaFeiYu-Local\data\`（含 `core\bilibili.sqlite`、运行库、journal）；
   - `~/.dsh/profiles/desktop\package.json` 与 `cordis.patch.yml`；
   - 当前正在使用的部署包目录（0.25.1-reading）整体副本；
   - `bilibili.sqlite` 用 SQLite 一致性备份（例如 `VACUUM INTO`，或先停实例再复制），不要只复制 WAL 状态下的单文件。
4. 备份后逐文件摘要核对数量与大小，写入部署记录。

## 2. 部署 A（0.25.2）

1. 确认 A 包目录与 `cordis.patch.yml`：
   - `settingsFile` 指向 `D:\DSH\DaFeiYu-Local\configuration\dafeiyu.config.json`；
   - `nodePath` 指向 Node 24.13；`startOnLoad: true`。
2. 将 `~/.dsh/profiles/desktop/package.json` 的 `dsh-dafeiyu` 依赖从
   `link:D:/DSH/DaFeiYu-Local/deployment/packages/dsh-dafeiyu-0.25.1-reading-20261031`
   改为 A 包绝对路径（`link:D:/DSH/DaFeiYu-Local/deployment/packages/dsh-dafeiyu-0.25.2-management-start-20261031`）。
   保持 JSON 为 UTF-8 无 BOM；改完解析一次 JSON。
3. 检查链接/解析实际指向新包（不要只看 package.json）：
   - `~/.dsh/profiles/desktop/node_modules/dsh-dafeiyu` 的解析目标；
   - 新包 `release.json` 的 `version=0.25.2`、`stores.bilibili=5`、`revision=dcf448a`。
4. 重启 DSH Desktop，等待管理中心可用；不在桌面自动操控页面。
5. 后台接口验收：
   - 冷启动：管理中心「启动实例」→ 状态依次进入 `检查配置/等待 QQ/启动实例/实例就绪`；最终 `running` 且 PID 与 `host-status.json` 一致；
   - 重复启动：已运行后再次点「启动实例」→ 不新增进程、PID 不变、无新错误、无重试；
   - 停止/重启：停止归一到 `stopped`；重启只在同一操作内先停后起；连续点击不产生第二个进程；
   - 失败场景：临时制造配置错误/Node 路径错误，确认错误码与处理建议可见且无无意义重试。
6. 保存 A 验收记录与回退包（A 包目录 + 备份路径 + 验收输出 JSON）。

A 未通过时停止，不进入 B。

## 3. 部署 B（0.26.0）

1. 在 A 已通过、实例已停止的前提下，备份当前数据（尤其 `bilibili.sqlite`）。
2. 显式迁移（不要期望构造器隐式迁移）：
   - 使用新包的迁移入口（`inspectBiliMigration`/`migrateBiliStorage` 或安装命令）对 `data\core\bilibili.sqlite` 执行 v5→v6；
   - 迁移前确认 identity/integrity；备份写入独立路径；
   - 迁移后核对：`user_version=6`、`application_id` 不变、原页面/阅读/历史/游标/回执行数与摘要一致、新增 `bili_auth_meta`/`bili_verifications` 为空。
3. 切换 profile 链接到 B 包；核对解析目标、`release.json`（`version=0.26.0`、`stores.bilibili=6`、`revision=21b89ba`）、无 BOM、无链接错位。
4. 重启 DSH Desktop；后台验收：
   - 冷启动/重复启动同 A；
   - B站管理面板显示：凭据状态、验证 UID、各范围暂停、读取路线；
   - 「验证登录」「测试读取」只做只读请求；重复点击复用同一操作；冷却时显示预计时间而不是悬挂。
5. 真实账号小范围验收（需用户显式同意并提供本地凭据文件）：
   - 一次登录验证 → 原失败视频信息 → 一次搜索 → 一页评论 → 一条字幕轨两次分页；
   - 记录每步是否真正发出请求、HTTP/平台码、耗时、登录验证次数与缓存命中；
   - 任一步出现账号不符、登录失效或新风险暂停即停止；
   - 不发送评论、点赞、私信或其他发布动作。
6. 长任务回归：固定数据 20 视频/7 段；真实账号下重复读取与短连续任务；重启/取消恢复。
7. 保存：迁移前后备份、验证记录、请求计数、`release.json`、客户端摘要、实际加载路径。

## 4. 回退

### 4.1 B → A

1. 停止实例。
2. 恢复迁移前的 `bilibili.sqlite` 备份（**必须**：A 的 v5 代码不能读取 v6 库）。
3. 保留升级后的库副本与差异记录（回退数据库会丢失新增验证记录/认证历史）。
4. profile 链接切回 A 包；核对解析目标与 `release.json`。
5. 重启，确认实例状态、QQ 在线、任务/消息队列符合预期；确认旧认证缓存没有沿用。

### 4.2 A → 0.25.1

1. 停止实例。
2. profile 链接切回 `dsh-dafeiyu-0.25.1-reading-20261031`。
3. 恢复匹配的配置/profile 快照（A 未改业务库版本，理论上可只切链接；仍建议保留备份）。
4. 重启并核对：管理中心启动、PID、`host-status.json`、占用释放。

## 5. 记录模板

```json
{
  "stage": "A|B",
  "package": "绝对路径",
  "loadedVersion": "0.25.2|0.26.0",
  "revision": "git 修订",
  "backup": ["配置", "数据", "profile"],
  "coldStart": {"pid": 0, "ready": true, "durationMs": 0},
  "repeatedStart": {"pidUnchanged": true, "spawnCount": 1},
  "stop": {"state": "stopped", "released": true},
  "bilibili": {"storeVersion": 5, "accountEngine": "verified|unverified", "requests": {}},
  "result": "passed|failed",
  "observations": []
}
```
