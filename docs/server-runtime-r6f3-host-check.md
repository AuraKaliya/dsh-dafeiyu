# R6f-3b B站渠道的 Host 装配与存储交接

完成日期：2026-10-27。统一入口固定装配 channel-bili-owner，使用 `coreDir/bili-owner.sqlite`，不扩展旧 paths.channels 或改变资源布局。正式真实端口与跨 profile 消费租约仍须由后续固定工厂提供；JSON 不能加载函数、任意代码或改变账号/主人。

## 已接通的行为

Host 检查 Memory 来源跟踪、公开 Bili/Media 依赖与完整任务 policy。B站 native policy 只允许当前 Task 来源/工作区、任务控制、公开 Bili/Media 读取与观察选择；资源只限公共材料与固定主人私聊，没有 server-executor、QQ、平台发布或其它生产者授权。

端口通过程序侧 `createBiliOwnerPorts` 延迟创建：在 daemon 完成配置/数据预检后才调用，single-run 不创建渠道、租约或平台连接。构造、恢复、Core deferred activation、真实账号 verify、releaseIngress 依次进行；排空停止新入站和 Task，已有回执保存，关闭渠道后释放自有资源。

新 schema 必须显式 init/迁移；普通打开不建库，不补 since。已有 profile 经备份、schema apply、manifest 绑定后，才另做已核验的服务器内 handover。缺 handover 继续报 `HOST_BILI_OWNER_HANDOVER_REQUIRED`。旧 seen/held/unknown/sending、来源和水位完整备份；关闭插件仍保留已有库。已有 v1 不为迁移构造服务或执行 recover。

optional 渠道缺端口/构造失败且没有依赖工作时降级，其已知专属动作不会伪装成可用；共享 conversation policy 仍可服务其它渠道，任意未知动作仍拒绝。**如果存在该渠道的旧消息、accepted/queued Task 或待交付结果，则在全局恢复/准入前保守拒绝不完整启动**；暂时网络或租约故障不被写成旧来源撤回。这是整体拒启保护，不是新建单生产者暂停功能。

## 相关检查记录

| 报告 | 结果 |
| --- | --- |
| `57d1558f-3cde-40f3-8911-c3edbe71e74a` | 新 Host 存储8/8；原公开 Bili存储3/3、运行1/1、Host profile12/12通过。组合56项39通过17失败，未称整体验收成功。 |
| `70d0873d-f03d-4406-af63-743c8d59ec7d` | 新 Host 运行7/7：聊天/重启、真实公开能力Task＋人格交付、缺端口、optional降级、旧Task保留恢复、single-run、排空。组合21项14通过7失败，另外7项渠道夹具后续已修。 |
| `8cdae2f6-c219-4db1-bdd5-7cce9b237817` | 新配置4/4：依赖顺序、固定身份和禁止JSON端口、禁止外部写/QQ资源/其它生产者、必需来源与媒体依赖。 |
| `5394c65b-2ca5-4a33-a987-12bd796c01e3` | 渠道集成14/14最终通过，详见 R6f-3a。 |

Host 的 Task 场景真实执行项目公开 Bili capability，取得合成公开页来源，目标人格只收到合法材料，未收到 opaque 原任务结果；独立校验后固定私信端口才得到最终正文。optional 恢复场景先通过真实主消息受理 Task、故意留下 accepted；factory/verify 两种故障均保留原 Run ID/state/error和模型调用数，正常恢复才继续同一 Run。状态不包含私信正文，新增字段可选以兼容旧快照。

模型、B站HTTP与消费者租约均为明确替身；Core、Memory、Host、SQLite、DSH任务与来源/交付管道实际运行。本步没有真实平台/模型费用、服务器数据迁移或线上变更，不声称生产端口、guard切换或整体现实验收完成。开发只跑相关范围，发布全量另行执行。

初次构建的固定UID类型扩宽用显式类型修复；后续发现optional异常处理、bindingFault快照兼容与旧Task恢复窗口，均补代码和实际场景，不仅改断言。独立审计见 `reviews/r6-bili-owner-host-runtime-audit.md`，存储细节见 `reviews/r6-bili-owner-host-storage-implementation.md`。成功D盘临时现场已回收，失败保留有界；原未提交修改保持。
