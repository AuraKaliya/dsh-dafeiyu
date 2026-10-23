# 大肥鱼 · 独立智能体插件项目

当前源码版本0.3.0：主插件、能力注册、统一事件记录、真实模型与QQ接入，以及按会话隔离的行为时间线检索和来源回查。DSH提供Agent循环、会话、持久化及原文查询。默认测试与演示使用模拟模型；真实接入需显式启动，第三阶段能力需显式启用。

## 开始使用

环境：Windows 本地验收使用 Node.js 24.13.0。项目固定 DSH 0.2.1-rc.2、Cordis 4.0.5，依赖锁在 `package-lock.json`。

```powershell
npm.cmd ci --ignore-scripts
npm.cmd test
npm.cmd run demo
```

`demo` 在 `.runtime/demos/<随机编号>/` 中创建独立的 SQLite 行为记录与 DSH 会话文件，展示两个隔离会话、一次扩展操作和完整回复交付。它是本地验收驱动，不是生产服务器入口；没有网络监听，不会读取现有 DSH 用户配置、QQ登录态或模型密钥。

Node 内置 SQLite 在本次 Node 版本中会输出 ExperimentalWarning；当前仅作为单机开发实现，不据此宣称已完成生产环境兼容性验收。

## 模块

| 包 | 职责 |
|---|---|
| `@dafeiyu/contracts` | 版本化接口、消息校验、能力和事件类型 |
| `@dafeiyu/journal` | 本地 SQLite、接收去重、会话映射、交付状态、时序与因果事件 |
| `@dafeiyu/core` | DSH 主插件；人格装配、会话运行、能力注册、队列和交付协调 |
| `@dafeiyu/channel-simulator` | DSH 关联插件；本机模拟渠道及确定性的发送结果 |
| `@dafeiyu/channel-qq` | QQ能力插件；本机SnowLuma适配、明确账号范围、事件接入与交付 |
| `@dafeiyu/timeline` | 当前会话行为检索、可见来源回查、分页和读取审计 |

## 文档

- [架构与开发决策](docs/architecture.md)
- [记忆、行为时间线、压缩和检索](docs/memory.md)
- [第一阶段接口与实现边界](docs/phase-1.md)
- [本地开发与后续部署流程](docs/development.md)
- [验收记录](docs/acceptance.md)
- [第二阶段真实模型与QQ接入方案](docs/phase-2-plan.md)
- [第二阶段本机接入实现](docs/phase-2-implementation.md)
- [第二阶段真实验收](docs/phase-2-acceptance.md)
- [第三阶段时间线与来源接口](docs/phase-3-timeline.md)
- [第三阶段验收](docs/phase-3-acceptance.md)

`profiles/persona.test.md` 是虚构测试人格，不是线上人格或私人记忆的复制品。长期记忆自动整理、专用压缩器、B站、管理员任务、图片/语音理解和自主更新操作尚未接入。

Git 只管理源码、测试、模板和文档。运行数据库、登录凭据、私人记忆和聊天记录不入库。尚未配置远端仓库；没有部署或修改服务器。
