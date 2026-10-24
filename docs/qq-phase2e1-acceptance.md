# QQ 2E-1：可信消息任务受理检查

日期：2026-10-25；接续 `db139bd`。完成[2E方案](qq-phase2e-plan.md)中的受理／状态接口，结果交付仍待后续步骤。

新增显式tasks配置（默认关闭）与独立qq-tasks v3扩展。`qq_task_submit`绑定真实调用对象、Journal入站、注册渠道／账号、配置主人、消息hash和固定执行策略。明确任务目标从主正文提取，模型只提议标题，不能改写goal；主正文与引用追加内容分开保存。旧消息缺主正文事实时拒绝猜测授权。支持直接请求引导及配置称呼，纯引用／普通观点不自动成为主人任务。

自发探索单列self-exploration，只获得来源会话资源；明确主人任务可使用来源会话与配置白名单。新Run是native，触发消息只是持久来源证明，不伪造第二条入站。TaskIntent沿既有memory执行接口写入动机；内部结果不通过聊天状态返回，也未接自动结果发送。`qq_task_status`只向来源会话返回元数据。普通新群聊天不改变任务epoch，来源撤回会阻止仍在执行的旧任务完成。

Host增加依赖／策略前置检查，单次run不因未启动的QQ任务专属策略误报。新增mainText为可选消息字段，旧消息／旧无消息任务保持兼容；execution_requests使用带schemaVersion的可选messageSource，数据库版本未变（runtime v2、memory v9、QQ v4）。没有数据清空或旧行改写；旧Host不支持tasks配置，不能用旧代码运行启用该能力的profile。

首轮5个相关文件（qq-task-acceptance、execution、execution-boundaries、qq-capabilities、host-profile）**44项通过，0失败／取消／跳过，9,261.9848ms**。补充普通聊天／撤回并发及Host任务策略断言后，只复测qq-task-acceptance和host-profile，**21项通过，0失败／取消／跳过，4,150.9731ms**。两次有重叠，不相加为独立场景数。结构化结果见[首次范围](results/qq-phase2e1-related.json)及[补充复测](results/qq-phase2e1.json)。类型构建与差异检查通过，未运行全量回归。

虚构夹具验证主人身份、引用、观点、goal覆写、跨群状态、克隆／过期上下文、请求幂等、兴趣资源隔离、原生动机和撤回。真实本地DSH与回环OneBot，模型和平台响应均为脚本。真实模型／QQ／服务器操作均为0，成功现场已清理；原未提交文档哈希保持，不暂存。下一步2E-2接入取消、改目标与阻断异议讨论后继续。
