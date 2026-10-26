# 大肥鱼当前范围与清理记录

2026-10-27。依据用户本轮决定：保留 R1—R5 修复和 R6 有价值功能；完整移除面向旧服务器的接管方案与完整运营资金授权系统；不使用子代理；全部测试在本机完成，服务器仅部署调通。

## 保留与移除

保留核心、人格试行/采用、记忆E、自主活动、QQ、多媒体、只读B站、B站主人私信、管理员执行、人格化任务交付、长期任务权限、基础共享计量、独立Host/运行装配及状态记录。保留本项目自身的数据升级/备份/恢复能力，不能把它误删为旧服务器接管。

删除 server-compat 整包及专用测试：旧 history.sqlite、旧23点版本身份、旧Markdown人格/共享记忆映射与对应来源工具均退出。删除未接入的 maintenance-controller 草稿及旧夜间/守护接管设计、旧服务器依赖扫描/清理探针、公开取证副本。旧代码和材料仍可按 Git 历史追溯，当前工作树不保留可启用的旧接管入口。

删除 funding-config/files/receipt/store、operations-authority、运营授权/增额测试及文档。没有创建真实运营资金库。测试账本 `.runtime/acceptance/7c-20261026`、原预算授权、费用未知记录及正式样本完整保留；取消运营授权产品不等于取消已批准测试额度的约束。

B站私信保留为新功能，但删除旧 seen/queue/claimed 导入及旧精度补偿分支。库版本为2，只支持新接收边界；不把旧v1库改标成新库。首次初始化后需显式指定接收起点，起点前消息标为 before-start，不入Core、不回放。项目自身新库升级/备份校验继续保留。

B站 API适配代码随插件放在 `packages/channel-bili-owner/vendor/bili-auth.mjs`，取消服务器旧 `程序/bili-lite/auth.mjs` 文件依赖和旧消费者停用证明字段。适配器仅保留现有会话使用、身份核验、WBI签名和请求处理；删除旧默认root、默认账号实例、未暴露的扫码写入方法。固定主人/独立账号、请求白名单、未知发送不重试仍保持。该变化没有连接平台或读取实际登录态。

## 启动入口的真实状态

普通 Host 原有 inspect/init/migrate/start/run/status 保留。server-runtime 保留 Windows生产工厂、父子共享准入、B站工厂、文件指纹与启动/关闭状态；移除 operator-init/operator-amend 和强制运营资金库。

`runServerCommand` 的 start/run 现在只借用程序提供的 `ModelBudgetAuthority`，不能从 JSON 加载函数、产生资金或伪造无限额度。命令行薄入口仅公开 inspect/status。**带管理员执行器的无人值守生产启动脚本仍须将所选择的共享计量端口接到此API；本次没有另造运营资金后端或声称一条 start 命令已经能独立上线。** 已有7C计量适配器只用于本机验收，不能复制到服务器冒充日常运营授权。

状态文件仅保存进程/Host/关闭原因的程序元数据；不再带资金窗口、额度和批准链。新鲜快照始终不单独证明进程存活。

## 已运行的相关检查

报告 `3ce71117-6080-494c-b55f-1935f1fad862`：12个相关文件、93/93通过。覆盖共享计量11、模型准入5、Memory预算3、启动配置6、状态12、本机Windows工厂6、B站存储8/渠道13/生产接口9、Host B站存储8/运行7、原B05来源5。

追加“新接收边界不导入旧队列”和“旧交接字段拒绝”后，仅复测两组；报告 `bdd96206-8a39-46fa-955c-e2c86f438766` 为18/18通过。两轮有重叠，不相加为111个独立场景。

这两轮实际运行本机 DSH/SQLite/Windows进程与接口，但模型、账号和平台响应均为虚构；realModel=false、realPlatform=false、serverAccess=false。没有跑全量回归，没有新增付费调用，没有部署。成功临时目录已回收，cleanup.blocked为空，失败保留仍遵守3次/72小时/1GiB。

原未提交 `docs/memory-phase-1.md` 保持原字节，SHA256 `CB9A2383531A39461C50D7CA8F58C6C1879CF12A0A0DAFDF8CFA5B387911F730`。没有重写历史Git提交、正式验收记录或服务器数据。

当前规范以 [架构](architecture.md)、[本机测试方案](integrated-acceptance-plan.md)、[部署调通范围](runtime-deployment-plan.md) 为准。旧阶段检查描述当时结果，不能代替清理后候选的发布验收。
