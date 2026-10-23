# 大肥鱼 · 独立智能体插件项目

当前项目版本0.12.0：核心0.9.0新增M5C第三部分C3-A——多代来源链、替代状态与来源有效性分离、无损组合展示和严格同源去重。保留独立分片、完整私有证明、短引用、局部失效、逻辑删除防复活与会话隔离，复用DSH阈值、持久化和恢复。contracts/memory/timeline仍为0.8.0。测试使用虚构样本和脚本模型，语义融合与原文重建尚未开启，新能力未加载到真实QQ或服务器。

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
| `@dafeiyu/core` | DSH 主插件；人格、会话、能力注册、上下文贡献协调与预算、旧快照退出、交付 |
| `@dafeiyu/channel-simulator` | DSH 关联插件；本机模拟渠道及确定性的发送结果 |
| `@dafeiyu/channel-qq` | QQ能力插件；本机SnowLuma适配、明确账号范围、事件接入与交付 |
| `@dafeiyu/timeline` | 当前会话行为检索、可见来源回查、分页和读取审计 |
| `@dafeiyu/memory` | 隔离存储、版本与删除、来源依赖、中文FTS5、BGE召回、token分片及profile缓存；独立分析、候选、工作记忆与选中证据 |

## 文档

- [架构与开发决策](docs/architecture.md)
- [记忆、行为时间线、压缩和检索](docs/memory.md)
- [记忆能力插件完整开发方案（2026-10-23）](docs/memory-plugin-plan.md)
- [中文记忆 embedding 本机实测与选型](docs/embedding-benchmark-2026-10-23.md)
- [现有 FastEmbed＋ONNX 服务的本机兼容验证与2GB预算](docs/fastembed-compatibility-2026-10-23.md)
- [记忆插件第一阶段实现与验收](docs/memory-phase-1.md)
- [记忆插件第二阶段检索实现与验收](docs/memory-phase-2.md)
- [记忆插件第三阶段独立分析与候选验收](docs/memory-phase-3.md)
- [第四阶段受控上下文装配、插件接口与验收](docs/memory-phase-4.md)
- [第五阶段主动压缩与归档开发方案](docs/memory-phase-5-plan.md)
- [第五阶段A工具反馈归档与回查验收](docs/memory-phase-5a.md)
- [第五阶段B阈值检查、增量压缩与验收](docs/memory-phase-5b.md)
- [第五阶段C多代摘要与精细来源开发方案](docs/memory-phase-5c-plan.md)
- [第五阶段C1精细来源记录与局部失效验收](docs/memory-phase-5c1.md)
- [第五阶段C2分片、局部视图与短引用验收](docs/memory-phase-5c2.md)
- [第五阶段C3多代摘要合并开发方案](docs/memory-phase-5c3-plan.md)
- [第五阶段C3-A来源链、组合展示与严格去重验收](docs/memory-phase-5c3a.md)
- [第一阶段接口与实现边界](docs/phase-1.md)
- [本地开发与后续部署流程](docs/development.md)
- [验收记录](docs/acceptance.md)
- [第二阶段真实模型与QQ接入方案](docs/phase-2-plan.md)
- [第二阶段本机接入实现](docs/phase-2-implementation.md)
- [第二阶段真实验收](docs/phase-2-acceptance.md)
- [第三阶段时间线与来源接口](docs/phase-3-timeline.md)
- [第三阶段验收](docs/phase-3-acceptance.md)

`profiles/persona.test.md` 是虚构测试人格，不是线上人格或私人记忆的复制品。定时批量整理、语义关系图、多代语义融合与原文重建，以及本项目中的B站、管理员任务、图片/语音理解和自主更新操作尚未接入。`npm run demo:context`展示多区域装配；`demo:compaction`展示压缩；`demo:provenance`展示来源隔离；`demo:fragments`展示同包局部退出与短引用；`npm run demo:composition`展示三代组合、同源去重、删除隔离与重启恢复。专属压缩需显式配置可用输入预算，不能与宿主另一压缩写者同时启用。

Git 只管理源码、测试、模板和文档。运行数据库、登录凭据、私人记忆和聊天记录不入库。尚未配置远端仓库；没有部署或修改服务器。
