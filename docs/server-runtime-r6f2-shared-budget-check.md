# R6f-2c 父子共享预算与受信资源工厂

> 历史子步骤检查记录。2026-10-27范围收敛后，旧服务器接管/旧资金系统相关后续要求作废；当前实现与测试边界见 [清理记录](current-scope-and-cleanup.md)。本文只证明原提交和原测试，不自动覆盖新候选。

日期：2026-10-26。新增独立 server-runtime 包，方向为 runtime→Host/executor，不把 Host 反向装入 standing-authority 模块。它借用已有资金权威，不新建余额、attempt、执行时钟或运营授权。

## 实现

同一 FIFO 只覆盖每次 reserve→实际流→settle，父任务结束模型工具调用回合后释放，子任务才能取得下一次许可；不会锁住整个 Run 等待自己的子调用。队列中的取消/过期不占用费用，未知用量或结算不明确关闭全部新准入，已发生调用仍完成记账。真实 jobId、父 profile、callId、路由和 reservation 分别绑定，不能互换。

父准入读取真实官方模型信息、默认输出和 reasoning 能力，启动前不匹配即拒绝；按每请求实际输出要求再次核验上限。重复挂载使用 Cordis 公开稳定的 application root 标识拒绝，包括 extend 出的子 Context。AsyncLocalStorage 只拦仍在途的真正嵌套请求；已结算调用遗留的异步上下文允许下一次正常调用。

7C 适配器继续使用原 EvaluationLedger；多个子 job 各绑定首次预留时的 attempt，父/子关联写入原 reservation request_key，保留现行调用证据。恢复不重放，不自行 account-at-maximum，也不重置 9 笔实际费用未知。

生产资源工厂只在显式 start/run 路径创建真实 WindowsProcessControl，提供 Host 的 awaited installer 与 job 预算端口；关闭顺序为 Host 排空/关闭→费用回调结束→Windows helper。未确认排空时保留端口用于继续核实，不能提前关闭后伪称已终止所有进程。工厂不关闭借用的原账本或时钟。

## 定向证据

| 报告 | 范围 |
| --- | --- |
| `b34e1d83-6368-4123-a41a-05b4bde2dfc7` | 共享 gate 11/11；新原账本父/多job适配 5/5；既有单job预算端口 4/4。 |
| `1f704242-1ddc-44f6-82f6-ee108507a62b` | 实际 DSH 父准入 5/5、实际独立 Memory 后台分析/压缩 3/3；同轮历史适配 10/10，合计18/18。 |

覆盖缓存用量归一化、准备后的冻结请求、tool回合释放、队列取消/到期、未知全局停止、重复/冲突结算、跨job身份、期限取消真实模型 signal、独立记忆分析及压缩实际取消、同一原时钟不增加、元数据默认输出预检与 teardown 顺序。

首次组合整体 48/59：本支线的实际重复挂载防线因 Cordis 服务代理身份变化失效，现已改为 root 身份；四处测试夹具试图在同 provider 再注册 adapter，被官方 SDK 正确拒绝。夹具现使用公开 registration 句柄的 dispose/replace，harness 仅透传原句柄，未改 SDK 规则或既有默认响应。修复后的相关 8 项在第二份报告通过；未为消除失败削弱断言。

模型流、账本金额和权限资源关闭替身均为合成样本；实际运行官方 DSH、Memory、SQLite、并发队列与取消链，没有真实网络模型费用。Windows 权限组件此前本机实测见 R6cde 记录；本次没有执行完整 production factory 的服务器管理员装配，不能把关闭顺序替身称为服务器证明。

当前仍无完整生产 CLI/运营预算窗口和远程验收预算通道；不能把7C原账本复制到服务器使用。完整媒体/共享金额联测、B站接管、夜间版本、guard、真实校准与部署仍待继续。仅跑相关测试；成功D盘现场已回收。原未提交文件不入本提交，原余额/时钟未增加。
