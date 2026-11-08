# 本机DSH 0.28.15部署记录

完成时间：2026-11-08 23:48（Asia/Shanghai）。用户授权部署，并明确由自己重新启动、继续实机测试。

**部署完成，等待用户重启。** DSH和旧实例已停止；本轮未启动在线实例，未调用真实模型或发送测试消息。

## 部署与保留

- 原部署0.28.14保留，新目录为 `D:/DSH/DaFeiYu-Local/deployment/packages/dsh-dafeiyu-0.28.15-local-20261108-r2`。
- 使用独立0.28.15发布包，API 11；49个直接依赖在新目录内解析，独立安装81个包。
- profile包声明、pnpm锁和实际目录链接均对齐新目录，解析到其 `runtime/plugin/lib/index.js`。
- 原实例设置、凭据和身份保持；其他插件的声明、锁条目和组合配置保持。
- 初始化重新生成当前Host策略，qq_sticker_send的外部调用许可仅授予主人QQ任务，不授予自主活动或其他任务策略。
- 自动启动保持startOnLoad:true，但本轮未触发启动。新进程就绪及实际业务表现须等用户重启后核对。

## 部署时发现并修复的兼容问题

最初r1在初始化前检查旧Host配置时返回 `HOST_QQ_STICKER_POLICY_REQUIRED`。原因是Host校验把新增的任务专用qq_sticker_send也列为聊天阶段必需动作，导致旧配置还未来得及重新生成就被拒绝。

已修正源码，聊天阶段仅要求其原有表情动作；任务阶段的发送仍需要独立外部调用许可。补充0.28.14旧配置重新初始化的回归断言后，重新完成608项全量回归、3项冒烟和独立包初始化/启动检查，均通过。使用新的r2目录构建与部署，未修改原r1封存内容。未部署r1，未绕过身份、占用或存储校验。

## 备份与检查

备份目录：`D:/DSH/DaFeiYu-Local/backups/before-0.28.15-2026-11-08T15-42-41.449Z-e09de33c`。

包含原程序及依赖、实例配置、数据、凭据及直接引用的凭据文件、profile声明/锁/组合配置。3701个备份文件已核对摘要；20个当前及历史SQLite库使用一致性快照，306张表（含内部序列表）的行数、内容摘要在初始化前后全部保持。

| 检查 | 结果 |
| --- | --- |
| 配置 | INSTALL_CONFIGURATION_VALID |
| 显式迁移检查 | INSTALL_CURRENT，结构已是当前版本 |
| 初始化 | INSTALL_INITIALIZED |
| 本机静态部署 | ready:true、online:false、无检查错误 |
| 数据版本 | runtime v7、B站v6，其他结构保持 |
| 原始发布包差异 | 本机副本仅cordis.patch.yml绑定本机路径与自动启动 |
| 程序状态 | DSH未运行，原实例PID不存在；未伪造新就绪回执 |

## 证据

- 部署汇总：`.runtime/local-deployment-0.28.15.json`
- r2验收绑定：`.runtime/feedback-fixes-0.28.15-deploy-r2-20261108.json`
- 全量：`.runtime/test-reports/47855b3a-4091-4eae-94f0-35907d89beaf.json`
- 冒烟：`.runtime/test-reports/d0510d58-eaf1-4c11-ba21-f670da0eb99f.json`
- 独立包：`.runtime/fresh-install-0.28.15-feedback-20261108-r2/acceptance.json`
- 原始r2包：`.runtime/releases/dsh-dafeiyu-0.28.15-feedback-20261108-r2`

原始发布内容SHA-256：`5c6ccb9a2685fe0d6db9f807e25447fa0986d13b3476664885d7c2cb37fb50ba`。

本机部署内容SHA-256：`541c9a622d4d441680cdfdd307afe471ea6e5c496286b797e43e8156433e1c34`。

用户可自行重启DSH，在管理中心确认0.28.15及当前实例就绪后继续测试。真实群发送和模型语义仍待复验；旧等待任务不因部署自动重放。回退前先停止实例并保留升级后新增数据，再恢复匹配程序、profile及数据备份。
