# 大肥鱼本地统一运行入口

本入口对应第一阶段1F。支持统一检查、初始化、迁移、常驻启动、一次性原生任务和状态查询。1G完整人格／资源评价、QQ业务增强、自主活动、完整媒体和B站仍按后续阶段实施；此入口不自动部署服务器。

## 1. 先使用隔离的测试配置

在项目根目录运行，要求Node.js `>=24.13.0 <25`：

```powershell
npm.cmd ci --ignore-scripts
npm.cmd run build
node scripts/dafeiyu-host.mjs inspect --config profiles/host.test.json
```

[host.test.json](../profiles/host.test.json)使用固定脚本模型、虚构底色和独立的`.runtime/host-test/`。它验证程序，不代表真实大模型行为或真实生活经历。首次inspect返回`ready:false`和退出码2，表示需要显式初始化，不会自动创建业务库。

**仅对明确的新空目录运行一次init：**

```powershell
node scripts/dafeiyu-host.mjs init --config profiles/host.test.json
node scripts/dafeiyu-host.mjs inspect --config profiles/host.test.json
```

已有目录或失败初始化不会被init清空。已有业务数据走迁移流程，不把init放进日常启动脚本。

## 2. 执行一次本地任务

```powershell
node scripts/dafeiyu-host.mjs run --config profiles/host.test.json --request profiles/task.example.json
node scripts/dafeiyu-host.mjs status --config profiles/host.test.json
```

[请求样例](../profiles/task.example.json)只包含requestId、目标及受限策略选择；不能指定执行身份、授权句柄或任意来源。相同requestId和相同内容返回同一次运行的状态／结果；改目标时不要复用该requestId。既有Task的继续运行支持taskId、expectedVersion及允许的输入引用，TaskRef由Host签发。

run会独占profile，执行后关闭。它不启动QQ接收、旧聊天／任务积压或后台分析，也不会把内部结果自动发到聊天。运行完status显示`online:false`、`phase:stopped`是正常结果。

也可使用自动构建的仓库命令：

```powershell
npm.cmd run host -- run --config profiles/host.test.json --request profiles/task.example.json
```

安装工作区依赖并构建后，包同时提供`dafeiyu-host`命令；Windows本地命令位于`node_modules/.bin/dafeiyu-host.cmd`。

## 3. 常驻运行与关闭

```powershell
node scripts/dafeiyu-host.mjs start --config profiles/host.test.json
```

start保持运行，开放已配置渠道并处理已受理队列。另一终端可使用status；第二次start或run会因profile已占用而拒绝。Ctrl+C／SIGTERM先停止新工作，等待已运行任务和交付收尾；超过配置期限则合作式取消，再保存状态并关闭。

不要通过删除占用记录接管仍存活的实例。已退出进程的记录会在事务核验后回收；核心数据库仍保留自己的占用保护。默认协调文件位于当前系统用户的`.dafeiyu/host-coordination.sqlite`，不是私人记忆库。不同用户／服务账户间的服务器切换仍需单独部署验收。

实际Windows终端验收中，Host完成关闭，外层PowerShell会话因中断返回1；应用状态、存储占用和终端退出码分别记录，不能只凭外层退出码判断数据是否已排空。

## 4. 本机真实模型配置

[host.local.example.json](../profiles/host.local.example.json)使用本项目新建的[正式底色](../profiles/persona.foundation.md)，指向独立`.runtime/local-formal/`，默认不配置QQ。它引用当前用户既有DSH凭据服务中的`DEEPSEEK_API_KEY`；不复制凭据、不把密钥写入配置，也不采用管理中心旧人格或私人记忆。

按需要调整`model-deepseek.config.credentialStore`为本机既有凭据文件位置。inspect只进行离线检查，能指出文件缺失；引用是否可用、模型及推理档位是否支持在启动时核验。旧凭据格式不会被Host偷偷迁移。

确认路径后，按inspect→init（仅新空目录）→run／start的顺序操作。正式与测试运行应使用独立profile和数据目录；`persona.kind`标明底色用途，本身不证明库中的材料是真实经历，也不会自动筛除用户选错目录中的虚构材料。

若启用QQ适配，需要显式提供独立本机测试账号、主人ID、群范围、回环OneBot HTTP／WS地址、tokenFile以及`paths.channels.channel-qq`。Host不负责启动QQ登录程序或复制服务器登录态。[QQ配置样例](../profiles/host.qq.example.json)使用虚构ID和脚本模型，复制并填写实际本机测试设置后才可使用；本轮没有启动它连接QQ。真实模型和平台验收已延期。

2B已加入可配置自然称呼和群列表同步。旧配置默认 `naturalNames:[]`、`groupSync.enabled:false`，保留原at／引用和静态群范围；样例启用“大肥鱼”“蓝色大肥鱼”，只识别正文直接称呼，引用／昵称不作为称呼或主人授权。群同步默认每30秒刷新，allowlist模式取配置群与已加入群交集；joined模式必须明确开启，才能开放所有实际已加入群。失败可在120秒内沿用本进程最后成功集合，过期拒绝群操作；重启后需重新成功同步。Host状态保存同步状态、错误、有效群数量与上次成功时间；失败显示degraded，仍可提供已授权主人私聊。图片／语音／文件和新任务交付仍待后续步骤。

当前QQ目标库为v3（2C-1缓存基础）。旧v0—v2库普通启动会提示迁移，先按第6节流程备份升级；不能用init重建旧目录，也不能让旧0.3.0二进制写升级后的库。群快照只记录账号绑定的成员范围，浏览短期快照也不等于长期记忆。

## 5. 配置与诊断

- 配置内路径相对配置文件解析；命令行文件参数相对当前目录解析。实际路径、目录别名及SQLite硬链接均参与互斥检查。
- agentId、数据路径、managed生命周期由Host统一提供，插件配置不得覆盖。配置只能选择允许清单中的已安装包，不能注入任意import路径。
- 模型路由显式配置；本进程DSH_HOME在加载DSH之前绑定到profile内部，不跟随桌面默认模型／数据路径。
- 状态快照位于core目录的`host-status.json`；它只保存元数据、时间、健康和计数。status还要核对PID、占用nonce、配置及更新时间，旧ready文件不能证明在线。
- 根配置`context.compactionInputTokens`或memory插件的完整compaction配置二选一。成长区域由`persona.growthRegion`控制，不能再在普通regions里重复定义。
- analysis、retrieval、compaction等未配置时明确显示；`configured`不等于已探测远端服务可用。activity、media、bilibili目前为not-configured。
- 新profile初始化不会写入底色模板或预设偏好；更换启动配置不会重置阶段人格。没有新增每轮调用次数上限。

退出码：0表示命令完成；1表示错误或任务失败；2表示检查未就绪、任务等待／中断或启动取消。status成功读取离线状态仍返回0，需查看`online`与状态字段。

## 6. 已有本地数据的迁移

迁移保持显式计划、备份、应用及核验，不并入start：

```powershell
node scripts/dafeiyu-host.mjs migrate plan --config path/to/host.json --backup-dir .runtime/migration-backups --out .runtime/migration-plan.json
node scripts/dafeiyu-host.mjs migrate apply --config path/to/host.json --plan .runtime/migration-plan.json
node scripts/dafeiyu-host.mjs migrate verify --config path/to/host.json --plan .runtime/migration-plan.json
```

命令会核对选定profile、实际路径、配置哈希和固定迁移计划。计划文件使用独占创建，不覆盖同名已有计划。活动Host占用的数据不能迁移；更换配置／路径后需要重新核对计划，不能套用另一profile的清单。

目标为journal v2、memory v8、runtime v2；旧D3及辅助权威库保持既有版本。检索缓存按现有v2、DSH查询索引按v8核验；其它派生索引版本需另行明确升级／重建，start不暗中接受自动重置。旧会话由DSH管理，不作为模板导入新会话。

迁移中断保持准入关闭；新版本已产生新数据后，不用旧备份覆盖新增记忆。原`scripts/migrate-profile.mjs`仍可用，新入口复用其底层迁移实现。

## 7. 验收记录

- [1F-1配置／预检／初始化](phase1f1-profile-inspection.md)
- [1F-2装配／准入／关闭](phase1f2-managed-runtime.md)
- [1F-3命令／真实模型／终端验收](phase1f3-cli-acceptance.md)

这些记录不替代1G的162次完整人格与连续性评价，也不代表服务器资源和部署已验收。
