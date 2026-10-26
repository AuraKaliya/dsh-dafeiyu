# R6e 执行器排空期间的来源核验

> 历史子步骤检查记录。2026-10-27范围收敛后，旧服务器接管/旧资金系统相关后续要求作废；当前实现与测试边界见 [清理记录](current-scope-and-cleanup.md)。本文只证明原提交和原测试，不自动覆盖新候选。

日期：2026-10-26。范围：Core 外部任务来源核验与执行器读取结果。没有付费模型调用或服务器写入。

## 问题和修改

Host 停止接收新任务后，已有执行器仍可正常完成。原 `sourceCurrent` 通过 producer.openTask 取得 TaskRef，却受到新任务准入关闭的限制；因此真实未撤回的任务在收尾时被误判为 SOURCE_STALE。失败现场中的子执行器 receipt 已完成，不能把误判改写成实际撤权。

新增 `externalTaskSourceCurrent` 只读核验：核对实际 Run、operation、插件／动作版本、任务当前 epoch／goal、精确 policy、原 QQ 消息或自主唤醒来源及完整授权摘要。它不创建 TaskRef、不恢复写 grant、不派发动作，也不修改状态。执行器读取归档时使用此接口，继续保留账号、主人、standing authority、撤回等原有核验。

## 检查记录

- 受管报告 `.runtime/test-reports/e7e4d118-20eb-4ae2-aebc-c9991284c9f5.json`：executor-policy 13、host-executor-runtime 6、server-executor-service 10，共 29/29 通过。
- 新 Core 用例明确验证：排空期间来源仍可核验；篡改 goal/policy/action/operation 或插件 owner 均拒绝；关闭准入后的 openTask 仍拒绝；已经结束的写 grant 仍不能恢复使用。
- 后续扩展“首次重启只交付一次、再次重启不重复”检查时，报告 `c1928403-c8ee-4b6f-ad6f-369d27a8ba69` 中 34 项通过 33 项、失败 1 项。失败是新增重启场景的调用计数断言（实际 2、预期 1），正在独立定位，不能将该轮整体标为通过。旧 Host runtime 20 和 CLI 8 项均通过。

这些检查使用真实本机 Core/Memory/Host 与回环渠道；模型、进程执行端口和外部平台为离线替身。它们不证明真实模型语义、真实 QQ 发送或服务器管理员权限。定向检查不替代发布全量回归。

测试目录均为 D 盘受管目录；成功目录已回收，失败现场按 3 次／72 小时／1 GiB 留存，清理阻断为空。原未提交 `docs/memory-phase-1.md` 保持不变。

后续结论：重启多出的发送是原聊天 ACK 的合法恢复，任务结果没有重复。夹具已分别核验两者，`21470e1c-fae9-452d-933d-d52980fb80a2` 中全部 6 项 Host 执行器场景通过，包括再次重启零重复。完整记录见 `server-execution-r6e-host-check.md`。
