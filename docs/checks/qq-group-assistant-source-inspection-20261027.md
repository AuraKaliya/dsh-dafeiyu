# QQ 群助手状态：源码检查

日期：2026-10-27（北京时间）。本轮仅检查；没有修改项目代码、SnowLuma 代码或配置，没有发送 QQ 消息。用户在协议确认阻挡实机检查后明确选择「这次先完成源码检查」。

## 结论与证据等级

源码证据支持从现有群列表协议读取群助手状态：`OidbSvcTrpcTcp.0xfe5_2` 支持请求每个群的 `msgMask`。无需为此新增同步周期，也无需逐群启动另一个状态轮询。

本机 SnowLuma 2.1.1 当前没有请求、解码和透传这个值，因此现成的 `get_group_list` 返回值仍不能判断群助手。协议字段及其含义由另一份公开实现交叉核对；本轮没有取得真实账号的字段返回，不能写成实机验收通过。

## 同一群列表请求中的字段

交叉核对版本：LLOneBot/LuckyLilliaBot `dc2b2b90092ef0f571b5546878288b83fff1e436`。

- [群列表请求](https://github.com/LLOneBot/LuckyLilliaBot/blob/dc2b2b90092ef0f571b5546878288b83fff1e436/src/main/qqProtocol/mixins/group.ts#L59)：`fetchGroups()` 使用 `0xfe5`、子命令 `2`，并指定 `config.config2.msgMask = true`。
- [请求与响应结构](https://github.com/LLOneBot/LuckyLilliaBot/blob/dc2b2b90092ef0f571b5546878288b83fff1e436/src/ntqqapi/proto/oidb.ts#L331)：请求路径的字段编号依次为 `config(1) / config2(2) / msgMask(7)`；响应为 `groups(2，重复) / personInfo(5) / msgMask(7，uint32)`。SnowLuma 对同一响应第 5 字段使用名称 `customInfo`，字段名称差异不改变线上的编号。
- [档位定义](https://github.com/LLOneBot/LuckyLilliaBot/blob/dc2b2b90092ef0f571b5546878288b83fff1e436/src/ntqqapi/types/group.ts#L1)：

| 值 | 含义 | 本轮讨论的处理方式 |
|---|---|---|
| 1 | 接收并提醒 | 保持现有规则 |
| 2 | 收进群助手，不提醒 | 排除全部自动处理 |
| 3 | 屏蔽群消息 | 另行明确策略，不能误标为群助手 |
| 4 | 接收但不提醒 | 保持现有规则，不能误判为群助手 |

上述是公开实现的枚举与协议结构证据，不是本机 QQ 各档位的实际对照结果。缺失值或未知值不能默认成 1，也不能用 `group_all_shut`（全员禁言）代替此状态。

## 本机 SnowLuma 的具体缺口

文件：`.runtime/snowluma-v2.1.1/runtime/index.mjs`。版本 `@snowluma/runtime` 2.1.1；检查结束时该文件 SHA256 为 `E23ED3D4AA7E01E7F45400A7FFE6B0C4B67BB6D011F776F2FD04B959510435E6`。

| 层 | 本机位置 | 已观察事实 |
|---|---|---|
| 底层群列表请求 | 45587、45628 行起 | 使用 `0xfe5_2`；`config2` 仅开启备注，第 7 项仍为 `field7: false` |
| 底层个人设置解码 | 45019 行起 | `CustomInfo` 仅解码第 3 字段备注；没有第 7 字段的数值解码 |
| 内部群对象 | 58671 行起 | `fetchGroupList()` 保存群号、名称、备注、成员数等；没有保存接收档位 |
| OneBot 返回 | 32383 行起 | `getGroupList()` 逐项构造响应，没有透传接收档位 |
| 扩展详情 | 11981、11995 行起 | `get_group_info_ex`、`get_group_detail_info` 复用同一个 `getGroupInfo`，不能作为现成替代来源 |

对照 SnowLuma 上游 `3bd74acb60e45fed7fa0451be11c54905dee0670` 的 [原请求](https://github.com/SnowLuma/SnowLuma/blob/3bd74acb60e45fed7fa0451be11c54905dee0670/packages/protocol/src/oidb-services/contacts/fetch-group-list.ts)、[响应定义](https://github.com/SnowLuma/SnowLuma/blob/3bd74acb60e45fed7fa0451be11c54905dee0670/packages/proto-defs/src/oidb.ts#L91)及[请求定义](https://github.com/SnowLuma/SnowLuma/blob/3bd74acb60e45fed7fa0451be11c54905dee0670/packages/proto-defs/src/oidb-actions/base.ts#L337)，上述缺口仍存在。没有在本轮下载替换或升级运行文件。

## 与大肥鱼现有入口的衔接（未实施）

- `packages/channel-qq/src/onebot.ts:37` 是平台群列表适配入口，当前只保留 `group_id/group_name`。
- `packages/channel-qq/src/groups.ts:55` 的 `GroupDirectory.effective()` 已统一供消息入站、群浏览、媒体访问和发送前检查使用。应保留完整的已加入群快照，在这里统一生成排除群助手后的有效集合，不能把收入群助手当作退群。
- 后续首选补齐同一次群列表的数据通路：开启请求第 7 项、解码响应第 7 项、保存并透传档位，再由大肥鱼群目录统一过滤。任何适配方式仍归入现有 `groups()` 刷新，不另建定时器。
- 当前 `get_group_list` 请求参数是 `{}`；SnowLuma 默认 `no_cache=false`，且已存在群快照时可能直接返回缓存。接入时必须让档位与群列表在同一轮刷新中保持新鲜，不能只更新时间戳而沿用旧状态。
- 同步频率继续使用已有 `groupSync.intervalMs`；现有默认值为 30000ms。关闭群同步时返回静态名单的分支也需明确约束，不能成为过滤旁路。
- 用户已确定：收入群助手后停止所有自动处理，包括 @、自然称呼和主动发言；移出后的接收边界与不补读规则仍须在后续实现和检查中落实。既有真实会话、记忆不删除。

## 本机启动与检查边界

本轮临时启动了已有 SnowLuma 管理进程，使用进程级覆盖关闭自动挂接、更新检查和文件日志；没有启动大肥鱼消费者，也没有挂接任何 QQ 进程。

管理端查询被当前用户协议／隐私政策确认要求阻挡。没有提交同意记录、修改密码、改变账号设置、调用原始 SSO 查询或发送消息。随后按用户选择终止实机检查，并关闭本轮临时进程。

结束检查：

- 临时进程已停止；13000、13001、15099 均无本轮遗留监听。
- 原 `onebot.json`、账号 OneBot 配置、`runtime.json`、`webui.json` 与启动前 SHA256 均一致；没有生成 `consent.json`。
- 本轮两个空的启动日志及其临时目录已清理。
- 没有运行模型、回归测试或平台消息测试；本轮结论仅为源码分析。
- 原未提交 `docs/memory-phase-1.md` 保留，不纳入本记录提交。本轮只新增此检查记录。

后续实机出口：在用户自行完成协议确认且明确继续后，仅对已核验本机账号执行同一群列表的只读查询，核对第 7 字段及已有群助手样本；没有受控样本时继续标记未验证，不能自行改变群接收设置制造样本。
