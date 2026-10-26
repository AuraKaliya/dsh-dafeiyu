# R6f-3a 固定主人 B站渠道检查

完成日期：2026-10-27。新增 channel-bili-owner，把固定独立账号 170759822／主人 13461350 的私聊与公开浏览能力分开。仅受信程序可提供 transport 与跨 profile 消费租约；本步没有生产 transport factory、真实平台调用或登录态复制。

## 已实现

- 独立 SQLite v1，普通打开不建库；显式 schema 初始化与 handover 分离。不补 since=now，不把空新库解释为已经迁移。保留旧 seen、queue、claimed、since、精度版本及 Number 舍入歧义；未认领消息只在真实端口精确复核后进入 Core，可能已处理的旧消息保留未知。
- 固定 private scene 和真实 mainText；Core 拥有人格会话，独立 bili-owner-tasks binding 处理明确任务、兴趣探索及控制。B站与 QQ 工具互相不能借绑定取得权限；不提供服务器外部写授权或公开发布。
- 结果经目标人格整理和独立验证后交付；普通 ACK 与任务结果分别持久。每条文字最多 1000 Unicode codepoint，不截断；原正文/实际 wire 摘要分别绑定。派发前记录计划，确认 receipt 后才算送达。逻辑交付键防止换 replyId 重试未知发送；重启不重做原模型。
- 新任务准入与旧来源当前性分开。排空拒新任务，正常重启可以在在线 verify 前核验旧来源；暂时网络故障不撤销原事实，实际账号/绑定变化持久阻断。稳定授权 epoch 不使用进程 nonce。撤回的跨库恢复只补 Core 观察，不调用模型或重新发送。
- 分页保留未完成游标，容量满时先安全接入已存 pending，避免永久停滞；constructor 失败清理自有 Cordis fiber，端口按一次归属释放，不关闭父 Core。

## 定向结果

| 报告 | 实际结果 |
| --- | --- |
| `57d1558f-3cde-40f3-8911-c3edbe71e74a` | Store 12/12；同批 Host 存储 8/8。组合56项39通过17失败，渠道构造未声明 Cordis inject，不能称全通过。 |
| `5394c65b-2ca5-4a33-a987-12bd796c01e3` | 渠道/真实 Core/Memory/DSH 脚本集成14/14。 |
| `70d0873d-f03d-4406-af63-743c8d59ec7d` | Host装配7/7另记；当时渠道7项失败是测试SQL错列及服务代理身份断言，组合21项14通过7失败。 |

修复期间没有放宽产品校验：Cordis 装配补 inject 与缺 Core 预检；SQL helper 改为实际 body 列；父 Core 存活通过公开 journal 身份、active/accepting 和资源释放检查，不比较每次新建的服务代理对象。初次类型检查的固定 UID 字面量扩宽已用显式身份类型修正，严格编译保持。

独立审计发现并补齐未知换 ID、排空准入、旧队列舍入碰撞、容量停滞和撤回恢复等真实缺口。以上测试实际运行本机 Core、Memory、官方 DSH、SQLite 与原生任务/交付流程；模型、B站 HTTP 和机器租约为明确替身，不能据此宣称真实登录、识图/音频质量、实际私信或服务器切换通过。

源码、方案和检查入 Git；正式服务器内 handover、固定 BiliAuth transport、真实消费者 lease、update-guard 切换仍待后续。成功测试临时目录已回收，失败保留不超过3次/72小时/1GiB；原未提交文档保持。
