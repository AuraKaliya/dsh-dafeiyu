# R6c/d/e：V3 服务、真实本机进程与官方 headless 接线

> 历史子步骤检查记录。2026-10-27范围收敛后，旧服务器接管/旧资金系统相关后续要求作废；当前实现与测试边界见 [清理记录](current-scope-and-cleanup.md)。本文只证明原提交和原测试，不自动覆盖新候选。

2026-10-26。三个代理分别完成能力服务、Windows 权限证明、官方 CLI 接线，主代理统一构建和定向检查。以下“真实”仅指明确列出的本机程序组件；模型均为脚本，未使用真实平台或服务器账号。

## 已完成

- 固定四个 V3 动作：主人执行、自主执行、当前 Task 状态、分页结果。分别核验实际 Core 来源、主人绑定或独立长期授权。工作目录、Node/profile/模型路由、预算和权限不来自模型参数。生产模式拒绝 run/clock/profile 替身；离线替身还必须使用 local-test/scripted 路由。
- 执行器 v1 库保持 job/operation/预算链接/回执的实际关系，结果归档在自身 `dataDir/results`。未知工具或进程效果阻止新派发，恢复不重放子任务。同请求重复读取实际回执；同标识不同输入拒绝。实际 Windows 证明、模拟标记和 helper 自述分别封存。
- 页面使用独立 server-executor scene。程序元信息只回到原真实主人消息目标；final 自述只对原主人私聊提供 inference 许可，并继承真实执行历史。来源撤回或权限变化使目标许可失效。服务不直接发 QQ，后续须通过已经接入的人格整理和忠实性校验。
- Windows 固定 PowerShell 探针通过原生进程 HANDLE 读取创建时间、实际可执行文件、TokenUser SID、提升状态、已启用管理员组和 restricted 标记。父子均须匹配配置的受信 SID 与固定 Node/hash；仅有计划任务 Highest 或权限模式字符串不算证明。
- Windows 端口只对原 ChildProcess 句柄进行受控终止。根进程退出/后代快照单独记录；首版没有 Job Object 等完整进程树约束，强制终止不能证明整树结束或业务回滚，明确 `verified:false`，保留 unknown。
- 固定 launcher 使用已安装 DSH 的公开 `profile-boot.runProfile` 与原 headless/Agent/Tools，不另写模型循环，不进入 bin 自动加载其它 `.env` 的流程。专用 child profile 不提供 QQ/Bili 发送、自动附件转发和未计费的模型工具；保留受信文件/命令工具。
- 仅在这个新建专用 profile 中不启用原始 session JSONL/DeepSeek session-log/telemetry 归档；使用原 DSH 内存 Session，不承诺 child 跨进程恢复。桌面基础组件及其配置没有改动。stdout 的 thinking、工具正文和原 stderr 丢弃，父进程只保存白名单结果。
- 每次真实 SDK 工具执行也经过父端许可和完成 ACK；只传名字、调用/参数/session hash 和状态，不传参数/结果正文。没有父许可就不能运行实际文件写入。

## 定向结果

在 `.runtime/test-reports/c6fa09e6-f61a-4016-925f-08da52609aa0.json` 中，下列各文件均全部通过：

| 范围 | 结果 | 证据性质 |
| --- | --- | --- |
| server-executor-service | 10/10 | 真实 Core/Memory/QQ 回环组件；runner、OS 端口和模型为明确离线替身 |
| server-executor-windows | 6/6，无跳过 | 实际本机 token、原生创建身份、真实 Node 子进程和受控终止；不证明服务器 token |
| server-executor-headless | 5/5 | 其中三项实际启动本机官方 DSH profile/headless，运行官方 write/read/pwsh 工具；使用脚本 provider，无 HTTP 模型请求 |
| server-executor-transport | 10/10 | 新 IPC 与费用/工具许可、未知及过滤逻辑 |
| server-executor-runner | 7/7 | 新协议下实际 Node 子进程收尾、退出与身份变化路径 |

同次运行的旧 QQ 交付 12/12 通过；主代理新增的目标许可夹具四项失败，组合运行整体为52通过/4失败，不能称该轮全量成功。夹具严格回执字段修复后的6/6证据在 `server-execution-r6e-target-check.md`，未放宽产品门槛。首次构建的 headless 监听器返回值类型已显式修正为 undefined；没有将构建失败计为运行通过。

测试数据位于受管 D 盘；失败最多3次/72小时/1GiB，清理阻断为空。没有执行新的付费模型验收或服务器变更。Host 的固定装配、增量启用/备份、生产凭据接线、原预算下的真实模型验收、guard 与线上切换仍待完成；此记录不宣称整个 R6 或部署已完成。
