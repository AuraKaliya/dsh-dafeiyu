# R 修复部署前：最小只读线上现状核验准备

本文件是管理中心准备记录的版本化镜像；已审阅探针存于本仓库`deployment/Inspect-DeploymentReadOnly.ps1`。探针保留UTF-8 BOM供Windows PowerShell 5.1读取中文路径；在Desktop版Parser验证语法错误0、中文路径字面量保持，未执行脚本本体。首轮仅采集公开元数据，真实token、当前登录、guard数据库和完整发行依赖闭包仍分别列为待核验，不因有限首轮结果形成删除动作。

2026-10-26。此文只依据本地运维脚本、2026-10-23自主更新保护验收记录及局部代码镜像编制。**尚未连接服务器，下面不是线上检查结果。** 没有读取连接指南、登录态、凭据内容或真实聊天；没有执行探针、模型、构建、Git或部署操作。线上路径、版本、账户与改动以之后实际采集为准。

## 核验目的与执行入口

先取得足以设计接入和保护现有记忆的有限现状快照：运行入口、版本、作用账户、公开配置、代码改动以及守护活动。不触发模型、不启动独立任务、不读聊天正文、不复制可变记忆，也不触发更新或重启。

用户最新澄清：本轮“清空其它插件”仅指后来通过市场额外下载或配置的插件，**DSH自身官方基础功能插件不能清除或替换**。基础服务和原软件文件同样保护。不能按包名、官方命名空间、发布者名称、所在目录或当前是否启用直接判断去留；须结合安装来源、发行版组成、实际profile及保留功能的依赖关系形成逐项清单。独立update-guard／maintenance、凭据、历史与重置后新增真实记忆不属于插件清除范围。

现有 `运维/Invoke-Server.ps1` 可作传输入口：必须由 Windows PowerShell（`powershell.exe`，不是 `pwsh`）运行。它在进程内部解析 `远程操作指南.txt`，建立 Negotiate PSSession，执行本地 ScriptPath，并在 finally 移除会话。默认路径即可；不把地址、用户名、密码复制进命令、文档或日志。

严格只读调用必须**只传 ScriptPath，不传 UploadDirectory／UploadDestination**。UploadDirectory 分支会创建远端目录并复制缺失文件。FilePath 分支可传输脚本文本执行，无需把探针保存到服务器。

待白名单探针另行完成审阅后，调用形态为：

```powershell
& "$env:SystemRoot\System32\WindowsPowerShell\v1.0\powershell.exe" `
  -NoProfile -NonInteractive -ExecutionPolicy Bypass `
  -File '.\运维\Invoke-Server.ps1' `
  -ScriptPath '.\运维\Inspect-DeploymentReadOnly.ps1'
```

`Inspect-DeploymentReadOnly.ps1` 是本方案建议的新探针名称，**本轮未创建、未执行**。不借用带日期的一次性初始化、切换、修复、Finalize、Retry 或更新提交脚本。主代理确定核验时机后再按方案实施。

## 最小字段白名单

每组返回 `observedAt`、固定 `sourceKind`、已审阅的来源路径、`available` 与短枚举状态；缺失、权限不足、结构变化分别标明，不用旧镜像补成当前事实。

| 范围 | 只返回的字段 | 只读取证方式与限制 |
| --- | --- | --- |
| 本次连接身份 | 时间、计算机名、连接账户、管理员组判定 | WindowsIdentity/WindowsPrincipal；这是本次核验会话身份，不是桌面或 CLI 的账户证明 |
| 运行进程 | PID、PPID、进程名、已校验 ExecutablePath、创建时间、GetOwner 返回的账户 | Win32_Process 仅筛选已知 DSH Desktop、相关 Node 和守护 PID；不输出整条 CommandLine、环境或进程内存 |
| DSH／Node版本 | 实际执行文件路径及 FileVersion/ProductVersion；已解析包的 name/version/main/exports 路径 | 从运行进程及启动任务解析路径，再读相应 package.json 白名单。必要时已验证 Node 子进程仅执行 --version，禁用继承的 NODE_OPTIONS/NODE_PATH，不运行 DSH CLI、npm、插件 import 或启动入口 |
| 产品与插件版本 | DSH、实际 QQ bridge、Bili、task-budget、update-guard 的 name/version；入口文件与 SHA256 | 区分已安装、profile启用、运行心跳自报三个证据。局部镜像版本不代替线上版本；只对代码／公开配置取hash，不读取凭据或记忆正文 |
| 包来源与发行归属 | 包名／版本／解析路径、`originClass`（builtin-distribution／marketplace-added／manual-added／linked-project／unknown）、发行清单或安装记录引用、公开lockfile完整性标识、是否共享安装 | 将发行清单、已知安装记录、profile package与解析链接交叉核对；来源信息不足标unknown，不用时间戳或“官方名字”替代证据。registry等来源只返回去除认证与查询参数后的批准主机／类别，不输出原始URL、npmrc或锁文件全集 |
| 实际装载关系 | desktop/CLI profile实际路径、选定profile标识、启用插件ID/包名、模块链接的解析目标、运行pid/version/loaded_at | 解析 profile选择、package-map、package.json、cordis.patch.yml，仅导出允许字段；核对 node_modules 链接。配置不是运行证明；没有模块装载证据时明确“已配置、未证实实际加载” |
| 基础与服务依赖闭包 | 发行版基础根、保留profile／服务根、每条依赖的from/to/version/kind及证据引用、反向requiredBy、共享目标、可选依赖实际使用状态、未解析边 | 只解析包依赖元数据、bundle／patch声明、模块解析结果及服务启动引用，不运行包或依赖安装。沿DSH官方基础功能和必需服务递归保留依赖；peer／optional依赖按实际装配核对，缺证不能推断可删；同时检查CLI、QQ/Bili接线、守护及maintenance的依赖 |
| Git状态 | 仓库根、HEAD、分支或detached、脏文件数、暂存／未暂存状态、允许范围内的相对变更路径 | git只读命令见下文；无diff正文、commit消息、remote URL、凭据配置或文件内容。保护区若意外受跟踪，返回类别／数量，停止扩大扫描 |
| 更新守护 | health.at/age、pid、stableId、activeId、activeStatus、lastErrorPresent、最近状态计数；任务运行状态 | 先读 health.json 白名单；再用现有 guard.sqlite 的只读事务核对meta与jobs。无lastError.message、job.reason、validation日志、完整payload或回滚快照导出 |
| 空闲信息 | QQ活跃会话数、queuedRoutes、serverTasks、memoryJobs、maintenanceJobs、versioning.running；Bili active/pending | 从健康文件计算标量；不返回route键、sessionId、消息ID、任务指令／摘要。这里只采样，不主动暂停工作或等待改写状态 |
| 三个区域 | maintenanceRoot、人格／共享记忆库／配置文件的解析路径、目录存在性、链接目标、layout列出的路径与接入标志 | layout.json逐字段投影；对core/preferences/recent/users等只查路径与文件元数据，不读正文。与实际加载模块引用、运行时sharedMemoryRoot/personaCore交叉核对 |
| 服务与计划任务 | TaskName/TaskPath、State、Principal.UserId/LogonType/RunLevel、Action.Execute、已解析脚本入口、WorkingDirectory、LastTaskResult/LastRunTime；相关服务的Name/State/StartName/ProcessId | 至少核对 DSH-Desktop-Whale 与 DaFeiYu-UpdateGuard；只扩展到已证实属于该产品的服务。Arguments和PathName先在远端解析，仅保留批准的程序／脚本路径，不整体返回 |
| QQ公开绑定 | layout.authority.ownerQQ/botQQ；实际启用代码对应的OWNER/BOT一致性；bridge enabled/dryRun/groups.mode；公开配置路径 | `配置文件/bridge.json`、layout与加载代码静态常量交叉核对；不读取scopes/state/server-tasks正文。首轮标为“配置绑定”，不宣称已实时验证登录账户 |
| Bili公开绑定 | accountUid/ownerUid/accountName、enabled、privateMessages.autoReply、publicInteraction.comments/danmaku；健康文件accountUid/ownerUid及时间 | `配置文件/bilibili.json`与`运行状态/bilibili/health.json`白名单比较；不读取session/login文件、不请求私信或刷新登录 |
| 凭据保护元数据 | 固定凭据路径存在性、ACL主体与权限类别、是否受Git忽略；不返回内容、长度或hash | 仅在确有部署保护需要时查询指定文件元数据；禁止递归导出凭据目录或读取本机／服务器登录态 |

所有字符串须按类型和范围校验。路径只接受预先允许的本地根或其经核验的扩展根；服务URL只允许输出协议／回环主机／端口，包来源只输出批准的来源主机和类别，均不保留用户名、密码、查询串或原始URL。任意未知字段和任意自由文本默认丢弃，不能以正则遮盖后原样输出整个对象。

## 保留／替换／移除清单的形成规则

每个条目至少记录：精确包身份与物理路径、来源证据、发行归属、实际profile启用位置、运行装载证据、依赖／反向依赖、关联服务、共享安装情况、代码与可变数据的边界，以及建议类别和具体依据。尚未解析的依赖边及来源冲突要单独列出；本轮只准备这些字段，不生成未经线上取证的删除名单。

| 建议类别 | 必须具备的依据与边界 |
| --- | --- |
| 保留 | DSH发行版自身官方基础功能、它们的完整必需依赖，以及保留服务／工具链的必需依赖均保留。独立update-guard和maintenance单独列为受保护组件；服务、计划任务和原软件文件不能随插件清理移除 |
| 替换 | 仅针对已证实属于后来额外安装／配置且需由新接入承担的非基础插件；列明替代入口、保留能力与依赖、数据归属和旧新profile关系。官方基础功能不进入此类；没有实际替代接线证据时仍列待核实 |
| 移除候选 | 已证实为后来额外安装／配置的非基础插件，且不属于任何保留组件或必需服务的依赖闭包，所有相关profile引用与共享目标均已查明。仅形成精确条目，不因父目录或node_modules位置而连带删除共享依赖／原软件；可变数据不随代码移除 |
| 待核实并保留 | 来源不明、实际profile不明、存在未解析依赖／共享引用、基础身份有冲突或运行证据不足。停留在清单中，不以猜测补齐“可移除” |

发行版是否内置和插件是否属于必需基础功能是两项证据；“官方发布的额外插件”也不能仅凭发布者自动归入基础，“第三方包”也不能仅凭名称排除在基础服务依赖之外。依赖闭包以实际保留的DSH功能、CLI和服务为根，明确每条依赖的理由；当前disabled不代表可以删除。

清理范围始终排除人格／共享记忆库、历史数据库、凭据及账号绑定、重置后新增真实记忆、update-guard状态／备份与maintenance。核验不得运行卸载、安装、清理、profile写入或服务控制命令；不能将“清空其它插件”解释成删除DSH基础包、运行时、基础服务、软件原目录或全部外部插件目录。

## 已知路径仅作定位线索

- 服务器维护根：`C:\DSH\DaFeiYu`；公开配置：`配置文件/layout.json`、`配置文件/bridge.json`、`配置文件/bilibili.json`。
- 历史启动入口：`配置文件/Start-DaFeiYu.ps1`；旧Node：`C:\DSH\runtime\node-v24.22.0-win-x64\node.exe`；旧DSH CLI：`C:\DSH\app\node_modules\@deepseek-ai\dsh\lib\bin.js`；旧桌面：`C:\DSH\desktop-app\DSH Desktop.exe`。首先核对当前任务及进程实际路径，不能固定使用这些旧值。
- profile：`配置文件/dsh-profiles/desktop`、`配置文件/dsh-cli-profiles/headless`；运行home：`运行状态/dsh-desktop`、`运行状态/dsh-cli`。旧代码还可能引用 `C:\DSH\desktop-state` 和 `C:\DSH\desktop-setup\plugins` 的依赖链接，不能只看新根目录就认定无外部依赖。
- QQ runtime／health：`运行状态/qq-bridge/runtime.json` 与 `health.json`；Bili health：`运行状态/bilibili/health.json`；守护：`运行状态/update-guard/health.json`、`guard.sqlite`、`enabled.flag`。
- 旧layout仍可能写`程序/qq-bridge`，而已验收代码曾实际启用`程序/qq-bridge-v073`。本地desktop package也同时保留多个版本依赖，cordis补丁禁用旧qq-bridge并插入v073。因此目录存在、package依赖列表、旧layout均不足以证明当前加载入口。
- 维护记录中的QQ主人／机器人号为756013063／2384779075；Bili独立账号／固定主人UID为170759822／13461350。它们是待比较的既有绑定，不允许用发现差异为由自动切换账号或复制登录态。

## Git与守护数据库的只读方式

Git用已验证git.exe，带`--no-optional-locks -c core.fsmonitor=false -c submodule.recurse=false`。只执行 `rev-parse --show-toplevel`、`rev-parse --verify HEAD`、`symbolic-ref --quiet --short HEAD` 以及 `status --porcelain=v1 -z --untracked-files=normal --ignore-submodules=all`。全部输出先在远端解析；变更路径允许代码与指定公开配置，保护区只返回类别／数量。不要执行fetch、checkout、reset、clean、add、commit、stash或完整diff；不读取git config全集和remote URL。

守护库使用已有Node内置`node:sqlite`直接 `new DatabaseSync(existingPath,{readOnly:true})`；先验证文件存在，短事务 `BEGIN`／`ROLLBACK`，只读 `meta` 的stableId/activeId及 `jobs` 的id/status/created_at。若需要时间等字段，从payload中只选明确字段；lastError只留是否存在和时间。记录queued数量和activeId对应状态，不能只靠health为null判断无待执行更新。无法只读打开就返回unavailable，不创建新库、不迁移、不调用Store、Guard或capture来补证。

文件系统、进程和数据库不是一个全局原子快照。采集前后再读守护时间／activeId／activeStatus；若变化、health过期、数据库与health不一致或有活动更新，将`coherent=false`并保留时间，交主代理判断核验时机。不自动干预守护。无活动更新也不表示所有代码已与stable快照一致，Git及必要代码hash另行核对。

## 默认Inspect为什么不能直接回传

`运维/Inspect-Server.ps1`不会显式打印token变量，也不直接打开聊天正文，但仍不能保证输出满足本次范围：

- 内部读取`snowluma.token`并请求本机`get_login_info`；embedding的两个health响应完整返回，未限定字段。
- `$health.logs`原样作为recentErrors；这些条目由任意错误／工具信息生成，可能带地址、任务片段或秘密。catch还返回原始Exception.Message，不能把它视为已脱敏。
- `serverTaskMode='independent DSH CLI / Administrator / danger-full-access / persona-reviewed result'`是硬编码。旧health中的`fullServerAccess:true`也由代码固定填写，均不能证明当前实际账户、工具注册或接线。
- Inspect-UpdateGuard原样打印整个health，含lastError和recent.error；Inspect-ProfileBoot返回原始日志、profile和CommandLine；Inspect-Runtime返回原始patch/package-map。它们也不适合直接加入白名单结果。
- Probe-UpdateGuardCurrent会在服务器写probe-current.mjs，再实例化可写Store；Store构造还会设置WAL、建表/触发器及初始化marker。`update-guard/cli.mjs status`同样经Guard构造进入Store，不能因名称为status便认作严格只读。禁止复用这些路径。

新探针应只构造上表的标量与小数组，输出前统一schema检查。错误只返回预设枚举（missing/access-denied/invalid-shape/busy/unavailable），不返回异常对象、堆栈、响应体、请求头或源行。不要用PowerShell transcript、Verbose/Debug、`Format-List *`、原始HTTP／JSON／YAML打印来留证。

第一轮无需读取任何产品凭据或访问QQ/Bili接口；只能确认公开绑定与带时间的本地健康事实。如主代理以后需要“当前登录账户”的证明，应另列只读核验：QQ仅固定本机get_login_info，Bili仅专门account-status，凭据只由既有程序内部使用，结果仅取账户ID／固定对象／登录布尔值，不调用读取私信、登录刷新或发送工具。未执行之前明确写“登录未实时核验”。

## 新Host与旧管理员CLI的能力缺口

本地`自主更新保护开发/程序/qq-bridge-v073/lib/cli-server-tasks.mjs`明确spawn旧Node和DSH headless入口，以服务器根为cwd，继承父环境并设置旧DSH_HOME及danger-full-access；headless profile依赖dsh-base／dsh-headless及Bili、task-budget、update-guard。任务结果经原QQ人格会话整理后才交付，且维护投递去重状态。

因此新Host不会因同账户、同目录、相同权限字符串或“fullServerAccess=true”自动拥有这条能力链。最小核验应分别证明：实际进程账户、实际启用的CLI profile与工具包、当前运行桥接是否仍装载ServerTasks适配器、真实主人身份检查所在入口，以及结果回原会话的接线。仅有安装文件时标为“存在但未证实装载”；本次不启动CLI、运行模型或发QQ消息来弥补证据缺口。

后续接入方案必须单独解决这条兼容路径，并保护当前服务器代码差异、人格偏好／关系记忆、历史与账号绑定。本准备记录不授权覆盖旧快照、不认定新版已具备管理员执行能力，也不把本地AI审阅当成线上验收。
