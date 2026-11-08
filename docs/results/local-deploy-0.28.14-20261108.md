# 本机 DSH 0.28.14 部署记录

完成时间：2026-11-08 22:20（Asia/Shanghai）。用户授权部署，明确由自己重新启动并继续人工实机测试。

**部署与静态检查完成，等待用户重启。** 操作前已确认DSH退出、原实例为stopped且PID不存在；本轮没有启动DSH或大肥鱼实例，没有发送测试消息或调用真实模型。新进程的就绪、在线及实际加载版本尚待用户启动后核对。

## 部署对象

| 项目 | 结果 |
| --- | --- |
| 原部署 | 0.28.13，原目录保留 |
| 新部署目录 | `D:/DSH/DaFeiYu-Local/deployment/packages/dsh-dafeiyu-0.28.14-local-20261108-r1` |
| 发布来源 | `.runtime/releases/dsh-dafeiyu-0.28.14-feedback-20261108-r1`，与600项全量、3项冒烟和独立包初始化证据匹配 |
| 实例配置 | 沿用 `D:/DSH/DaFeiYu-Local/configuration/dafeiyu.config.json`，内容摘要保持 |
| 数据 | 沿用 `D:/DSH/DaFeiYu-Local/data`，身份和全部原表记录保持 |
| DSH profile | `C:/Users/Administrator/.dsh/profiles/desktop` 的包声明、pnpm锁和实际目录链接一致指向新部署 |
| 实际解析入口 | 新目录的 `runtime/plugin/lib/index.js` |
| 自动启动 | 部署补丁保持 `startOnLoad:true`；本轮未触发启动 |

新目录自行安装81个依赖包，49个直接依赖全部在部署目录内解析。依赖锁和实际依赖内容与已验收原包一致，没有借用工作区node_modules。模型、百万上下文、QQ/B站、媒体及自主活动等实例设置保持原配置，凭据文件没有改动。

本机副本与原发布内容唯一差异为 `cordis.patch.yml` 中绑定现有设置文件、Node路径和自动启动。原发布包及其清单不改写；本机副本的独立内容摘要另行记录。

## 备份与数据检查

备份目录：

`D:/DSH/DaFeiYu-Local/backups/before-0.28.14-2026-11-08T14-17-15.502Z-e230c678`

包含原0.28.13程序及依赖、实例配置、数据、实例凭据及直接引用的凭据文件、profile包声明/锁/组合配置。3668个备份文件已核对摘要。SQLite使用一致性快照，涵盖当前及历史20个数据库、306张表（含SQLite内部序列表）；其中当前8个数据库共145张表。显式迁移检查与初始化后再次核对原表行数和内容摘要，全部一致。

没有删除数据、改写数据库版本、重建实例身份、清空任务或修改已确认发送回执。全局账号登录态沿用现状。

profile修复工具另存备份：

`C:/Users/Administrator/.dsh/profiles/desktop/.profile-repair/2026-11-08T14-19-57.872Z-099ec1fa-feb5-41ba-bc80-9c68cf803ff8`

除dafeiyu依赖声明、对应锁条目及目录链接外，其他插件的声明、锁和组合配置均核对未变。

## 检查结果

| 检查 | 结果 |
| --- | --- |
| 原始发布包及验收身份 | 通过，未重建或替换原始包 |
| 配置检查 | `INSTALL_CONFIGURATION_VALID`，连通性未测试，模型调用0 |
| 显式迁移入口 | `INSTALL_CURRENT`，现有存储已经是当前结构，无结构迁移 |
| 初始化 | `INSTALL_INITIALIZED`，保留既有身份与记录 |
| profile声明/锁/模块解析 | 一致指向0.28.14 |
| 本机静态部署检查 | `ready:true`、`online:false`、无检查错误；runtime v7、B站v6 |
| 停止状态 | DSH未运行，旧实例PID不存在，未伪造新版本就绪记录 |
| 用户随后重启后的业务验收 | 待执行 |

原发布内容SHA-256：`5bc12e8073a0156e8c5dee8a250f98c65564fb2e60b76580dbaa73d692b489df`。

本机部署内容SHA-256：`0ab6b93582f758fc75bcdaf1ba6ea91a62b1f7ae19cf64383f61a63a2eecc5b4`。

机读记录：`.runtime/local-deployment-0.28.14.json`。备份内有 `manifest.json` 和 `configuration-result.json`。

用户现在可以自行启动DSH，在大肥鱼管理中心核对0.28.14及当前进程就绪后继续对话测试。需要回退时先停止实例并保存部署后新增数据，再恢复匹配的程序、profile和数据；不要直接覆盖后续测试产生的记录。
