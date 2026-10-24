# 大肥鱼 · 独立智能体插件项目

当前项目版本0.19.0：contracts/core/memory 0.15.0完成D3交付凭据与模拟闭环；journal/channel-simulator为0.4.0。先在目标DSH人格会话整理，再核验目标、来源、版本与授权，使用持久凭据发送最终正文；迟到、重复、撤销和不确定状态不会盲目重发。本机421项测试及模拟渠道演示通过；本轮使用虚构样本与脚本模型，真实QQ未接入，服务器未修改。

第一阶段实施进度：1A适配探针、1B契约与受控生命周期、1C存储与迁移、1D任务执行已完成。当前470项回归通过；1D另有真实模型多步任务与重启续接验收，1A音画探针单独记录。1E人格成长／连续性及正式Host仍待后续子步骤，现有QQ和服务器未切换。

1D已完成[执行验收](docs/phase1d-execution.md)，1E-1完成[底色与增量存储](docs/phase1e1-foundation-storage.md)，1E-2完成[显式阶段状态](docs/phase1e2-stage-persona.md)，当前488项回归通过。1E-2另有新底色与虚构候选的真实模型接口验收。1E-3完整观察／贡献、任务意图和压缩连续性仍待完成；正式底色新建于本项目，不使用管理中心现有人格文件。

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

- [大肥鱼人格成长与连续性方案（1.0）](docs/persona-growth-continuity-plan.md)：爱世界的底色、阶段人格、独立判断与任务责任、污染／漂移防护、压缩接续、数据演进与验收。
- [本轮人格方案文档核验](docs/persona-growth-continuity-review.md)：文档范围、既有代码回归、链接／编号检查和原有修改保留；不作为新功能验收。
- [大肥鱼统一运行、唤醒与插件协作接口方案（1.2）](docs/unified-runtime-wakeup-plugin-plan.md)：渠道／能力分离、自主活动、记忆E、音画理解、人格职责及各阶段依赖；按阶段实施，尚未整体完成。
- [第一阶段：核心与统一运行入口开发方案（1.1）](docs/unified-runtime-phase-1-plan.md)：managed装配、v2/v3兼容、底色与阶段状态、无聊天任务、增量迁移与验收；1A—1C完成、1D中途、1E—1G待实施。
- [第一阶段1A适配前提验收](docs/phase1a-adaptation.md)：DSH程序来源、真实模型工具续轮与持久化、真实图像和本地音频探针。
- [第一阶段1B接口与生命周期验收](docs/phase1b-lifecycle.md)：v2/v3兼容、启动准入、恢复／激活分离、延迟分析与QQ连接。
- [第一阶段1C存储与迁移验收](docs/phase1c-storage.md)：Run账本、Task事件、增量schema、只读预检、备份和中断续接；使用虚构旧库。
- [第一阶段1D任务执行验收](docs/phase1d-execution.md)：470项回归、v3渠道与动作、取消／恢复边界及真实模型任务续接；首轮失败与成功复测分别保留。
- [第一阶段1E-1底色与存储验收](docs/phase1e1-foundation-storage.md)：新底色、严格读取、人格数据契约、memory v8/runtime v2、旧Run兼容和增量迁移。
- [第一阶段1E-2显式阶段状态验收](docs/phase1e2-stage-persona.md)：候选、采用／撤下、受控投影、来源变化与真实模型接口验证；失败及修正单列。
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
- [第五阶段C3-B限定条件、受控融合与原文重建验收](docs/memory-phase-5c3b.md)
- [智能体级记忆与跨场景任务连续性方案](docs/agent-memory-continuity-plan.md)
- [阶段A范围拆分与旧数据迁移验收](docs/agent-memory-phase-a.md)
- [阶段B插件观察与选择性记忆贡献验收](docs/agent-memory-phase-b.md)
- [阶段C跨场景任务工作区与并发验收](docs/agent-memory-phase-c.md)
- [阶段D核心授权、检索与对外交付方案](docs/agent-memory-phase-d-plan.md)
- [D1任务内部跨场景检索验收](docs/agent-memory-phase-d1.md)
- [D2表达判断、独立交付材料与干净重建验收](docs/agent-memory-phase-d2.md)
- [D3交付凭据与模拟渠道闭环验收](docs/agent-memory-phase-d3.md)
- [第一阶段接口与实现边界](docs/phase-1.md)
- [本地开发与后续部署流程](docs/development.md)
- [验收记录](docs/acceptance.md)
- [第二阶段真实模型与QQ接入方案](docs/phase-2-plan.md)
- [第二阶段本机接入实现](docs/phase-2-implementation.md)
- [第二阶段真实验收](docs/phase-2-acceptance.md)
- [第三阶段时间线与来源接口](docs/phase-3-timeline.md)
- [第三阶段验收](docs/phase-3-acceptance.md)

`profiles/persona.test.md` 是虚构测试人格，不是线上人格或私人记忆的复制品。定时批量整理、语义关系图、跨组主题融合，以及本项目中的B站、管理员任务、图片/语音理解和自主更新操作尚未接入。`demo:composition`展示无损组合与来源链；`npm run accept:memory-semantic`用虚构样本和当前绑定模型验证受控融合与原文重建。其余演示见各阶段文档。专属压缩需显式配置可用输入预算，不能与宿主另一压缩写者同时启用。

Git 只管理源码、测试、模板和文档。运行数据库、登录凭据、私人记忆和聊天记录不入库。尚未配置远端仓库；没有部署或修改服务器。
