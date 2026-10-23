# 第五阶段A：工具反馈精简、原文归档与回查

日期：2026-10-23。项目0.8.0，contracts/core/memory/timeline为0.5.0。仅本机虚构样本开发，无服务器、真实QQ或模型凭据操作。

## 已实现范围

记忆插件可通过`feedback: {}`启用反馈归档服务。核心仅处理本智能体注册且明确声明反馈协议的工具；普通工具返回的模型内容和规范值保持原样，其他DSH智能体不受影响。API_VERSION=2保持兼容，新增字段均为可选。

本轮实现确定性的结构化精简，没有调用模型总结工具结果。主动阈值检查、历史摘要和多代压缩仍属于[第五阶段后续计划](memory-phase-5-plan.md)。

## 工具接入协议

能力声明`feedback: 'structured-v1'`，并返回以下完整JSON结构：

```json
{
  "schemaVersion": 1,
  "outcome": "partial",
  "effects": "none",
  "completeness": "partial",
  "resourceVersion": "fixture-v1",
  "summary": "上游仅返回部分资料",
  "diagnostics": [{ "code": "UPSTREAM_PARTIAL", "message": "剩余分页尚未获取。" }],
  "receipts": [],
  "sourceRefs": [],
  "data": "实际返回的虚构正文"
}
```

`outcome`支持succeeded、failed、partial、unknown、running；`effects`支持none、applied、partial、unknown；`completeness`支持complete、partial、unknown。DSH工具协议成功取得一个报告，不代表报告中的业务操作成功，模型必须读取这些独立状态。

核心绑定真实插件标识、插件版本、工具名、会话、来源消息trace和操作事件。模型不能提供route或覆盖这些字段。只有反馈提供者自身的回查工具能声明`archive-view`并签发回查视图。

接口只接受工具实际返回的JSON值；文本通过data字段承载。归档保存完整返回值的JSON表示及文本内容，**不是网络报文或文件的逐字节备份**。已识别凭据、reasoning/thinking等字段先脱敏，不能宣称覆盖任意未知秘密。

默认单份归档上限2MiB，可配置至8MiB。超限明确返回`ARCHIVE_CAPACITY_EXCEEDED`，不静默截断后假称完整归档。这一阶段没有流式管道采集接口；已在上游丢失的输出无法由归档恢复。

## 精简反馈

默认反馈预算8192 UTF-8字节，可配置4096—65536，包含核心附加的视图来源字段。它不是生成模型的精确token计数。

始终保留执行状态、副作用状态、原始完整性、资源版本、全部结构化错误代码、诊断/回执总数、归档引用和状态版本。摘要、完整诊断文字或回执列表放不下时，`omittedFields`明确说明未内联的字段；这些字段仍可单独回查。正文最多给600码点预览，标出是否还有内容。

反馈携带`snapshotOnly`与采集时间，表达当时观察。例如running反馈不意味着后台任务在未来仍然运行；resourceVersion是工具声明的资源版本，不等于系统重新核对了外部资源现状。

普通未适配工具不做猜测性裁剪。格式不合约的返回值归档为invalid-result，反馈保留unknown与`INVALID_FEEDBACK_REPORT`。工具抛出异常时只归档程序生成的安全未知状态，不保存任意原始异常文本；该档案的origin为exception，不能声称取到了原工具的完整返回值。

原操作已完成但归档失败时，保留已知业务状态、副作用和错误代码，明确标记归档不可用。没有自动重放、自动重试有副作用工具或重新执行历史命令。

## 存储、来源与版本

`dataDir/feedback.sqlite`保存不可变原文、来源元数据、独立逻辑状态、幂等请求账本及审计outbox。原文与元数据不写入Git。档案、状态和归档审计在同一SQLite事务内提交；outbox向核心日志发布固定事件ID，重放不产生重复事件。

每次工具操作生成一份独立档案。相同操作标识与相同内容可幂等确认，不能用相同标识覆盖另一份内容。每份原文的contentRevision为1；删除/恢复推进状态version；工具的resourceVersion单独保存。新一次资源读取生成新档案，不覆盖旧观察。

来源包括原工具操作事件和可选声明依赖。当前声明依赖支持本会话有效记忆及标准化原始入站消息；记忆依赖绑定内容revision、状态version和哈希。其他会话、缺失或不支持的来源使该档案不可用于正常/历史/删除内容读取，不能借删除入口绕过授权。

反馈头部缓存最多128份，不缓存全部原文。每次准入重新读取归属和逻辑状态，并核对依赖；首次加载头部及打开正文会校验原文哈希。该缓存依赖原文不可变约束，不以它代替删除检查。

## 回查接口

| 工具 | 用途 |
|---|---|
| `dafeiyu_tool_feedback_open` | normal读取有效档案；history显式读取来源已更正的旧观察 |
| `dafeiyu_tool_feedback_deleted_open` | 显式查找自身或依赖已逻辑删除的档案 |
| `dafeiyu_tool_feedback_list` | 最近最多50条范围内索引，无正文；支持normal/history/deleted |
| `dafeiyu_tool_feedback_delete` | 按expectedVersion逻辑删除档案 |
| `dafeiyu_tool_feedback_restore` | 按expectedVersion解除档案自身删除标记，不恢复上游来源 |

更早记录可通过已有时间线的`feedback.archived`事件定位，其元数据包含完整归档ref。归档引用为`dafeiyu:feedback:<uuid>:1`。

读取必须携带expectedVersion，可选择document、data、diagnostics或receipts部分。分页按Unicode码点，默认每页1500，配置上限4000；cursor绑定会话、档案、状态版本、哈希、模式及部分。换会话、换部分、删除或恢复后不能继续沿用旧游标。

`hasMore=false`只表示当前档案部分已读完；`originalCompleteness=partial`仍然保留。不存在把上游部分结果读完后改称完整的行为。

所有回查是只读档案，不触发原工具。回查结果标为不可信派生材料，不能直接通过既有时间线记忆入口当作新原始证据自动提炼。将反馈档案接入独立分析或长期记忆的专门依赖图，留待后续明确实现。

## 视图失效与插件隔离

核心为自己呈现的反馈写入DSH私有presentation metadata，普通工具返回同名JSON字段不能获得该标记。正常简短反馈在档案及来源有效时保留；所有原文回查页，包括normal/history/deleted，只允许用于请求它们的当前回合，后续回合需显式重读。

档案删除、来源更正/删除、提供者卸载或回查回合结束后，核心通过DSH单节点替换撤下对应正文。DSH要求工具结果替换只能改变content，因此保留消息ID、toolCallId、isError和私有metadata，维持调用/结果配对。原始DSH事件与档案继续保留。

时间线打开旧tool/result时也经过同一校验，不能绕过档案删除取得旧反馈正文。请求发出后才发生失效时，旧结果不会继续交付；已经发送给模型的内容不能追溯撤回。

该机制只撤下带核心标记的反馈与回查节点，不改写普通工具、其他智能体或无关装配区域。助手已经转述的内容、原始用户消息、其他工具自行复制的文本不属于本轮全面删除范围；后续历史摘要仍需来源依赖和失效传播。

## 验收与限制

运行`npm test`与`npm run demo:feedback`。本轮新增28项反馈测试，既有164项，合计192项。覆盖五类结果状态、UTF-8预算、Unicode分页、原始部分状态、来源与版本、逻辑删除/恢复、跨会话拒绝、旧时间线绕过、重启、异常脱敏、容量拒绝、存储事务失败和生成期间失效。

本轮采用真实DSH服务与模型循环、模拟模型、虚构中文资料。没有真实QQ/B站工具适配或服务器部署，也没有重新调用真实模型或embedding服务。演示记录见[memory-phase-5a-results.json](memory-phase-5a-results.json)。

尚未实现主动历史压缩、模型摘要、失败经验自动整理、持久归档容量治理和冷归档搬迁。档案保留不会自动物理删除；磁盘长期增长需要单独确定治理方案。
