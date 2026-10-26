# 原版 SnowLuma send_packet：群助手状态只读验证

日期：2026-10-27（北京时间）。本次为真实本机 QQ 协议读取验证，未调用模型，未修改 SnowLuma 或大肥鱼代码，未发送 QQ 消息。只新增／关联检查记录。

## 结论

通过。原版 SnowLuma 2.1.1 的既有 `send_packet` 可以只读获取群列表及每群 `msgMask`。本轮一次原始请求返回 6 群，接收档位均存在且属于已知枚举：3 群为 2（群助手），3 群为 1（接收并提醒）。群号集合与标准群列表完全一致。

这条路径允许本项目自己的 QQ 适配层实现读取与过滤，不要求维护或安装修改版 SnowLuma。此次是读取能力验证，没有实现过滤逻辑，也没有验收移入／移出后的同步行为。

## 用户授权和运行身份

- 用户授权在本机使用原版 `send_packet` 做固定只读验证，禁止修改双方代码或发送 QQ 消息。
- 本机没有持久协议同意记录。用户明确同意当前用户协议及隐私政策，并授权仅在本次临时验证进程中声明同意。使用 `SNOWLUMA_ACCEPT_EULA=1`、`SNOWLUMA_ACCEPT_PRIVACY=1`，启动后恢复调用进程原环境；没有写入 `consent.json`。
- 使用项目先前配置的本机测试账号。通过管理端识别到唯一匹配进程，仅临时挂接该测试 QQ；没有挂接另一个个人账号。
- 读取前后均通过 `get_login_info` 核对配置账号，并通过 `get_status` 确认在线。没有启动大肥鱼消费者或连接事件 WebSocket，没有调用模型。
- 关闭自动挂接、自动更新检查和文件日志，仅以进程环境覆盖生效；没有保存设置。

## 原版证明

接口返回 `app_name=SnowLuma`、`app_version=2.1.1-node`、`protocol_version=v11`。

本机 `.runtime/snowluma-v2.1.1/runtime/index.mjs` 与已下载原始 `SnowLuma-v2.1.1-win-x64.zip` 中的 `index.mjs` 字节哈希一致：

```text
SHA256 E23ED3D4AA7E01E7F45400A7FFE6B0C4B67BB6D011F776F2FD04B959510435E6
```

没有替换发行文件、打补丁、升级版本或向运行程序注入自写 JavaScript。诊断编码／解码在一次独立进程的内存中完成。

## 固定只读请求

HTTP action 为原版 `send_packet`；参数固定为：

```json
{
  "cmd": "OidbSvcTrpcTcp.0xfe5_2",
  "data": "08e51f1002220e0a0c0a06180120012801120238016001",
  "rsp": true
}
```

这 23 字节请求只选择群列表字段，不含目标用户／群号、消息正文、凭据或任何设置写入指令。OIDB envelope 为 command=4069、subCommand=2、reserved=1（UIN form）。请求 body 的 `config(1)/config2(2)/msgMask(7)` 置 true，另外请求成员上限、成员数及群名。发送前在内存中复核上述 envelope 与第 7 项，未运行未知命令或 setter。

请求 SHA256：`b4e6a3a9856f6ea95621b29da38f23e52a4e3ac5e4c176bc453b588b09aea673`。

返回为原始响应 hex；在诊断进程中按 protobuf 边界、wire type、单值／重复字段和整数范围进行解码。检查 OIDB 错误码后，从 `body(4)/groups(2)/customInfo(5)/msgMask(7)` 读取状态。没有读取聊天历史、消息正文或平台登录态。

## 实际结果

| 检查 | 结果 |
|---|---|
| 原始 SSO 读取次数 | 1 |
| 原始响应长度 | 1014 字节 |
| 标准 `get_group_list(no_cache=true)` 群数 | 6 |
| 原始协议返回群数 | 6 |
| 两种读取方式的群号集合 | 完全一致 |
| 接收档位 1 | 3 群 |
| 接收档位 2 | 3 群 |
| 接收档位 3／4 | 本轮各 0 群 |
| 缺失／未知档位 | 各 0 群 |
| 前后账号、在线核验 | 通过 |
| QQ 消息发送调用 | 0 |
| 模型调用 | 0 |

为减少私人数据，本记录不保存实际账号 ID、群号、群名、响应 hex 或鉴权信息。脱敏分组结果如下；代号只用于本次检查，不能当作后续群身份。

| 代号 | msgMask |
|---|---|
| group-1 | 2 |
| group-2 | 1 |
| group-3 | 1 |
| group-4 | 2 |
| group-5 | 1 |
| group-6 | 2 |

`2` 与 `4` 的含义继续依据前次已固定的[公开档位定义](https://github.com/LLOneBot/LuckyLilliaBot/blob/dc2b2b90092ef0f571b5546878288b83fff1e436/src/ntqqapi/types/group.ts#L1)。本次没有改变群接收设置，也没有声称已验证档位 3／4 或 QQ 界面切换时序。

## 后续实现边界（本轮未实施）

- 维护本项目自己的 QQ 平台适配器，使用原版 SnowLuma 已有接口；不维护 SnowLuma 补丁或专用发行分支。
- 在现有 `OneBot.groups()` 数据入口完成固定只读请求、受限解析和状态归一化，由现有 `GroupDirectory.effective()` 统一过滤群助手。
- 一次原始群列表响应已同时包含成员关系和接收状态。正式实现不必照搬本次核对用的「标准列表＋原始列表」双读取；核对请求只是验证手段。
- 沿用现有群列表刷新、账号校验、串行化、陈旧期和 `groupSync.intervalMs`，不新增同步周期。`send_packet` 不作为任意原始协议工具暴露给模型。
- 缺失／未知字段、接口不支持或响应不完整时必须明确报告，不能默认为普通群；仍须处理静态名单分支、已排队回复、移出后的接收边界和旧消息不补读。
- 后续实现另做本机定向检查。本轮没有修改产品代码，因此没有启动回归套件或宣称过滤功能已上线。

## 结束状态

- 管理端解除本次临时挂接成功，测试 QQ 恢复为 available、injected=false、connected=false；没有关闭 QQ 本身。
- 临时管理进程已停止，13000／13001／15099 无遗留监听；本轮启动日志和临时目录已清理。
- 启动前后 5 份配置（全局／账号 OneBot、runtime、ui、webui）SHA256 全部一致；未生成 `consent.json`。
- SnowLuma 代码哈希与原始发行包一致。大肥鱼产品代码无变更。
- 原有未提交 `docs/memory-phase-1.md` 保留，SHA256 仍为 `CB9A2383531A39461C50D7CA8F58C6C1879CF12A0A0DAFDF8CFA5B387911F730`，不纳入本轮提交。
