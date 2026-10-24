# 1F-3：命令入口、状态与真实验收

日期：2026-10-25（北京时间）。基线`6c680d6`。本步完成1F剩余命令及有限真实验收；第一阶段还剩1G。原未提交修改保留，全程未连接或修改大肥鱼服务器。

## 交付

提供`dafeiyu-host inspect/init/migrate/start/run/status`，仓库兼容入口为`scripts/dafeiyu-host.mjs`，npm入口为`npm.cmd run host -- ...`。包bin、离线安装后的Windows命令及help已经核验。

CLI在加载DSH前绑定本进程隔离目录，统一处理JSON配置、严格业务请求、稳定错误码及信号关闭。一次性任务不启动渠道或旧后台队列；常驻Host允许正常输入并保持状态心跳。已有profile不自动初始化，不在start中隐式迁移，不创建远程控制端口。

状态读取校验格式、实例nonce、PID、profile／agent、配置哈希和更新时间；未知字段或损坏快照拒绝。离线、过期和配置不符不会误报在线。预检同时能报告缺失的模型凭据文件，不读取或复制凭据值。补充SQLite硬链接身份比较，避免不同目录名实际共享同一数据库而绕过占用检查。

新模板为`profiles/host.test.json`、`profiles/host.local.example.json`及`profiles/task.example.json`。具体命令、退出码、数据边界、迁移和QQ配置见[使用说明](host-usage.md)。模板不会覆盖既有底色、阶段状态或记忆，真实QQ仍未在本步接入账号测试。

## 程序与模拟模型验收

最终`npm.cmd test`：**529项通过，0失败、0跳过**，测试部分61,433.852毫秒。本步新增[7项CLI／状态测试](../tests/host-cli.test.ts)，与此前522项一起回归。

覆盖离线检查、显式初始化、一次性任务、新进程重复请求零新增推理、请求身份伪造拒绝、未知命令参数拒绝、离线凭据文件缺失、模拟SIGINT的排空、快照时效／身份／注入字段、真实迁移命令的计划／应用／核验／重复应用、旧行哈希保留、错profile计划拒绝，以及SQLite硬链接互斥。

这些测试使用实际进程、DSH、SQLite和文件；模型为脚本，SIGINT测试通过Node事件模拟，不能称为实际终端按键测试。结构化记录见[程序验收](results/phase1f3-cli.json)。

## 真实模型命令验收

`npm.cmd run accept:phase1f-host`通过真实CLI子进程调用现有DSH DeepSeek配置，使用新底色、全新隔离目录及虚构任务，不访问真实QQ／B站。

[最终记录](results/phase1f3-host-real.json)：**7项检查通过**。首次任务产生2次DSH模型请求，实际调用`dafeiyu_task_intent`并完成；第二个进程以相同requestId读取同一Run和原结果，新增模型请求为0。状态显示stopped／不在线，未输出任务正文；DSH持久文件未发现reasoning／opaque replay；既有凭据文件指纹保持不变。报告记录配置／底色哈希、模型、插件、Node／SQLite版本及测试时Git基线。

先前记录分别保留：

- [首次驱动失败](results/phase1f3-host-real-initial.json)：驱动把inspect预期的退出码2当成异常，丢掉了“可初始化”的JSON结果，整体失败；当时没有调用模型。修正的是验收驱动，未放宽Host准入或初始化规则。
- [较早成功样例](results/phase1f3-host-real-before-final.json)：2次模型请求及重启去重成功。完成后续路径防护和报告元数据补充后，又运行了上述最终验收；各次使用独立虚构profile。

## 实际Windows终端

另外创建隔离脚本模型profile，在实际Windows PTY内运行start。另一进程status报告在线，第二次start返回`HOST_ALREADY_OWNED`。向该终端发送Ctrl+C后，Host输出stopped，随后status为不在线，离线inspect确认数据库占用全部释放。

[终端记录](results/phase1f3-host-console.json)与模拟SIGINT分开。PTY外层PowerShell会话返回码为1，按中断记录，未宣称其正常0退出；Host状态及存储关闭检查通过。没有调用真实模型或真实平台，测试结束未遗留运行的Host。

## 版本与后续

1F-1提交`47e021b`，1F-2提交`6c680d6`；本步命令、模板、测试及记录验收后独立提交。1F使用的SQL目标不变，Host清单／快照为v1。包版本和Git标签的正式发布归1G统一处理。

原`docs/memory-phase-1.md`仍不暂存，SHA-256保持`CB9A2383531A39461C50D7CA8F58C6C1879CF12A0A0DAFDF8CFA5B387911F730`。本步检查暂存差异，不推送、不部署、不改服务器。1G完整人格／压缩对照、资源工作负载与阶段发布验收尚未开始；不能将本步7项真实接口检查计作162次完整场景评价。
