# 2026-10-29 当前协议架构开发检查

代码与本机验证已完成。版本为 **0.24.0**，扩展协议为 **API_VERSION 4**，全部 15 个自有模块同步发布版本。包含本记录的 Git 提交为本轮最终开发提交。

## 已实现

- 统一当前扩展、动作、调用上下文和公共装配配置；移除 V2/V3 兼容导出、旧注册路径、数据迁移器、旧缓存读取回退及退役验收工具。输入只按当前结构校验。
- 拆出 ConversationCoordinator；任务运行、记忆投影、渠道交付及存储检查各自负责自己的边界。Host 通过模块检查接口装配，执行器归档检查移回执行器模块。
- 普通任务由主 DSH Agent 判断完成或等待，并直接交付已保存的最终回答。工作复核仅为可选工具；跨范围材料保留独立表达和核验。
- 事实经历、操作结果、主动反思、自我认识分别留在 Memory。初始底色只导入一次；不再运行独立的人格提案、试用和采用链。
- 任务结束不自动制造记忆整理请求。Agent 可明确申请整理，Activity 等当前运行结束后交给 DSH 执行。
- 保留同格式内的回执、幂等、未知效果、历史修订和崩溃恢复。修复会话投影并发、状态快照校验、压缩恢复以及经历索引重新暴露撤回原文的问题。
- 测试按当前源码重新编译子进程夹具并清理失效编译产物；公开包的隔离安装、冷启动和重启检查通过。

## 最终验证

全量运行：`131d205a-be3b-4477-a09a-93da04ba391a`。

| 项目 | 结果 |
| --- | --- |
| npm test | 1070 项；1067 通过，0 失败，0 取消，3 跳过 |
| 源码构建、测试及工具类型检查 | 通过 |
| npm ls --depth=0 --offline | 通过，全部自有模块为 0.24.0 |
| git diff --check | 通过 |
| 临时测试空间清理 | 无阻塞，既有容量与保留预算未调整 |

跳过的可选检查：

- selected local formal backends actually decode speech, run ASR and sound events, and parse a document
- explicit real verifier accepts supported wording and rejects a changed visible fact
- a publishable package installs with pnpm without private workspaces and runs the same cold-start/restart checks

结构化记录见 [20261029-current-contract-tests.json](20261029-current-contract-tests.json)。最终运行开始于 2026-10-28T19:29:39.069Z，结束于 2026-10-28T19:37:40.384Z。

原有未提交修改已先保存为 `c212a6aa9396085bc2da4577d86882b2b43d35cf`；完整开发差异可从该提交比较至包含本记录的提交。退役工具与存储测试的清单也已保存在本目录。

本轮只在 `D:\DSH\DSH workspace\dafeiyu` 开发与检查。未发布、未部署服务器，未外发真实 QQ/B站测试消息，也未进行付费模型或真实媒体后端的语义验收。开发数据不迁移；接口变化后使用新的空数据目录初始化。
