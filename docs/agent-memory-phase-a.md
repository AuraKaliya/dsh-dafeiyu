# 智能体级记忆阶段A：范围拆分与兼容迁移

日期：2026-10-24。项目0.14.0，contracts/memory 0.10.0，core仍为0.10.0。只使用本机虚构数据库和脚本模型，未打开真实QQ记忆库，未操作服务器。整体方向见[开发方案](agent-memory-continuity-plan.md)。

## 范围模型

MemoryView新增boundary，单独保存owner、sourceScene、task、internalUse、externalExpression，以及schemaVersion/policyVersion和赋值来源。effectiveAccess反映当前head与全部祖先限制的交集，避免把历史版本的旧声明误当成当前授权。

| 字段 | 本轮取值与来源 |
|---|---|
| owner | agent身份，来自可信操作范围 |
| sourceScene | 精确会话信息和入口插件；无法识别的旧route保留为legacy-route |
| task | unassigned或带route命名空间的conversation-task |
| internalUse | 原会话或none |
| externalExpression | 原会话或none，与internalUse独立保存 |
| assignment | legacy-migration或conservative-create |

sourceScene的ingressPluginId表示触发写入的消息入口，不冒充全部证据的生产者。实际证据插件和原文继续通过sources与事件引用追踪。正常写入从已校验ActionContext、核心消息入口及当前工作状态取得场景和任务；模型参数不能填写这些字段。

历史任务不明、或后台写入没有可信任务信息时使用unassigned。分析job ID不会被当成大肥鱼任务ID，同名conversation-task在不同route中不等价。该字段尚不是全局任务工作区或跨会话授权。

## 存储迁移

memory.sqlite由user_version=1升级到2，application_id不变。新增memory_boundaries，以记忆ID＋内容revision为键，保存范围JSON及哈希；新增memory_schema_migrations记录迁移版本、时间、条数与策略。范围记录禁止原位修改或删除。

采用旁表而不改写旧revision正文。以下七张旧表全部保持原行：memory_items、memory_revisions、dependencies、scope_generations、memory_events、outbox、requests。内容哈希、原始来源、内容revision、状态version、逻辑删除理由、幂等指纹/回执和待发送事件均保留；迁移不增加记忆状态代数。

每个旧内容版本的保守映射：

1. owner取原agent_id。
2. 来源保留原route；只有精确匹配既有会话键格式才解析渠道等字段，入口插件仍为null；其它route不猜测。
3. task为unassigned，不用当前工作区倒推历史任务。
4. 内部与表达范围均保持原会话。
5. assignment为legacy-migration，policyVersion为1。

BEGIN IMMEDIATE锁内重读版本，逐行补充旁表，最后提交版本标记。损坏正文、身份不匹配或不完整外键图使整个迁移回滚，不覆盖重建。重复打开不重复迁移，未知数据库和未来版本拒绝。新空库采用同样兼容结构初始化，但没有旧记录被补记。

旧程序只识别v1，将拒绝v2；本轮没有自动降级。未来真实部署先备份和核对程序，不能只回退代码并强改PRAGMA。当前迁移验收对象全部虚构。

## 读取、继承与写入

底层可信MemoryStore.read新增purpose参数internal/expression，默认expression。表达路径须同时满足内部使用和表达限制。当前head及全部祖先都参与检查，读取历史版本不能绕过后来的范围收紧。

正常工具读取、历史/已删除查询、列表、全文/BGE召回、上下文选择仍走表达路径；现有后台分析也保持原有范围。模型接口不能通过purpose参数切换到内部读取。跨场景内部任务和独立交付授权留待后续阶段。

底层新建/修订命令可使用boundaryPolicy收紧某个维度为none，正常模型工具不接收该参数。新版本继承旧head及全部记忆祖先限制，显式扩大请求拒绝。真正的扩大授权需要未来独立的授权与版本流程。

范围字段不进入WriteContent哈希。显式boundaryPolicy属于命令指纹，重试不能改变它；可信场景/任务绑定在首次写入捕获，重复请求只返回原回执，不拿当前任务覆盖历史归属。

boundaryAllows只检查单个绑定，不能代替MemoryStore的来源链、当前head和删除校验。缺失、错误归属或哈希损坏的范围记录拒绝读取，不退回宽松默认。

## 来源与删除防复活

迁移不改来源图、sourceFence或scope generation。已有效的上下文不会仅因补充范围元数据失效；已退出的片段也不会重新加入。

后续范围收紧使用新revision和状态version，即使正文哈希相同，缓存、已选证据和摘要仍会复查版本。来源限制沿依赖链继承。逻辑删除/恢复保留既有行为，恢复推进状态版本而不放宽范围，不恢复已退出摘要。

其它数据库——DSH会话、工作状态、反馈、分析队列和检索索引——保留格式与当前会话限制。本轮不合并群聊/私聊上下文，不新增全局查询、不改变插件贡献策略，也不把所有观察自动入库。

## 验收

- `npm test`：310项通过，新增18项专项测试。
- `npm run demo:memory-boundaries`：六个旧内容版本迁移、七张旧表精确保留、回执/围栏保持、两种范围分离、跨会话拒绝和重启验证。
- 提交前检查改动格式及依赖锁。原有docs/memory-phase-1.md无关修改保持，不纳入提交。

专项覆盖迁移事务回滚、未来版本、重复与并发打开、不猜测旧场景、可信入口与任务、模型字段伪造、多代继承、历史版本绕过防护、删除恢复、旁表损坏、事件写入回滚、相同内容哈希下的索引失效及DSH摘要防复活。

旧库验证使用独立原始v1 SQL夹具；DSH连续性测试另在虚构会话中移除新旁表来复现兼容v1布局，确认迁移后B仍有效、A的退休片段不会因恢复而重新加入。没有调用真实模型、读取真实私人记忆或执行服务器容量测试。

机器可读结果：[agent-memory-phase-a-results.json](agent-memory-phase-a-results.json)。后续依次接入观察/贡献接口、跨会话任务工作区和受控跨场景访问。
