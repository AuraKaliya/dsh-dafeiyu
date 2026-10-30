# 大肥鱼可部署检查表

日期：2026-10-30
代码提交：`099355e`
版本：`0.25.0`
范围：本机构建/测试/发布包检查；不连接真实平台，不调用真实模型，不部署到服务器。

## 1. 已通过的检查

| 检查 | 命令 | 结果 |
|---|---|---|
| 全量测试 | `npm test` | 269/269 通过（60 个测试文件） |
| 构建/类型源码编译 | `npm run check` | 269/269 通过（同一套构建测试） |
| 短冒烟 | `npm run test:smoke` | 3/3 通过 |
| 公开发布包 | `npm run build:release` | 986 个文件，7,047,085 字节 |
| 发布包隐私/内容检查 | `node scripts/check-public-release.mjs <release>` | `passed:true`，无 findings |
| 发布包 npm 清单 | `npm pack --dry-run --json` | 600 个条目，包名 `dsh-dafeiyu@0.25.0` |
| 发布包入口导入 | 使用仓库 `node_modules` 临时 junction 导入 | `{"ok":true,"exports":["Config","apply","inject","name"]}`；导入后已移除 junction |

最新发布目录：

```text
D:\DSH\DSH workspace\dafeiyu\.runtime\public-releases\<最新 UUID>
```

`.runtime/` 不是发布物，部署时应重新 `npm run build:release` 或使用已复制到部署机的包。

本次候选发布：

```text
D:\DSH\DSH workspace\dafeiyu\.runtime\public-releases\27eb02c8-bec5-4d7a-afbf-301367bd8274
```

v10 已在本机运行：Host PID `42760`，profile 指向

```text
D:\DSH\DaFeiYu-Local\deployment\packages\dsh-dafeiyu-0.25.0-attention-v10-20261030-201548
```

QQ online（3 个有效群），phase degraded 仅因 B 站匿名 HTTP 诊断暂停；B 站 health 已分别显示 HTTP/Browser 状态。

已用 `npm run deploy:prepare` 生成并校验一个干净候选：

```text
D:\DSH\DaFeiYu-Local\deployment\packages\dsh-dafeiyu-0.25.0-attention-v10-20261030-201548
```

`node bin/dafeiyu.mjs check` 返回 `INSTALL_CONFIGURATION_VALID`，无真实模型/平台调用。

## 2. 部署前必须实现/确认

### 2.1 计费 authority

`dafeiyu-server start/run` 必须由 Program API 传入 `ModelBudgetAuthority`；JSON 不能创建钱或模块。

本版新增可选方法：

```ts
acceptLocalUnknown?(code: string): void;
```

- 单次调用超时/取消后 usage 未知时，`SharedModelBudget` 不再全局 `cancelBudget`；
- authority 若实现 `acceptLocalUnknown`，应清理该调用的 unknown 计费状态，让其他会话继续；
- 未实现时，authority 自己的 `guard()` 仍可能拒绝后续调用（财务安全边界），这不属于插件包能单独解决的部分。

**部署前必须确认 authority 的 unknown 计费政策与 `acceptLocalUnknown` 一致，并做一次本地超时→下一会话调用验证。**

### 2.2 渠道回执对账

`unknown` 反馈不会自动重发；启动/每次派发会检查同 route 的 `notice.attempt`，有 `sent` 回执则补 sent，否则保持停泊。

如果目标渠道不能按 `deliveryId` 查询回执，unknown 需要人工/外部运维核对；这不是重复发送，但会一直不恢复。部署前应确认：
- 渠道交付是否记录 `deliveryId`/receipt；
- 是否有外部回执查询或人工对账流程。

支持查询的渠道应实现 `FeedbackReceiptPort.lookup({feedbackId,route,deliveryId})`，并在 Core 启动后调用：

```ts
const unbind = core.bindFeedbackReceipts(port);
```

返回 `sent` 会补记送达；`not-sent` 会回到 pending 重试；`unknown` 或查询失败会继续停泊。QQ 当前的 `QqDeliveryLedger.progress(replyId)` 已保存分段状态和 receipt，部署层可据此实现该端口。

### 2.3 配置与隐私

- `dataDir` 必须在安装包外，首次使用独立空目录；
- 模型凭据走 DSH credential store，不写配置文件；
- QQ bot/owner、OneBot 地址、token 文件按 `examples/dafeiyu.config.json` 填写；
- `dshTools` 默认关闭，除非明确接受系统工具风险；
- 不复制本机登录态、群列表、聊天记录。

### 2.4 真实平台验收（未做）

以下不属于本机发布包检查，部署前/灰度时必须单独做：

1. OneBot 连接、机器人 QQ 登录、私聊收发、撤回/群失权；
2. 一条真实模型普通回复；
3. 一条真实任务 + 执行器 + 结果交付；
4. 边聊天边后台的 RunLease 让出；
5. 单调用超时后其他会话继续（依赖 2.1）；
6. 反馈自动派发的 must-know/worth-sharing 与 unknown 停泊；
7. 进程重启后的未完成发送/unknown 状态。

### 2.5 调度与定时器边界

- 普通插件 Host 目前只启用 Core 的运行级 RunLease/Conversation 调度，**没有安装** `server-runtime` 的 `installModelAdmission`；调用级排序、共享预算和取消隔离不能视为已生效。要启用必须走 `server-runtime` production 启动路径并绑定真实 `ModelBudgetAuthority`。
- 反馈自动派发已改为 Core 独立 30 秒 tick，不再依赖 `activity.enabled`；Activity 只负责探索/维护。
- B 站 `health` 现在包含独立的 `diagnostic.http` / `diagnostic.browser` 状态；`degraded` 只表示至少一条通道被诊断暂停。

## 3. 发布包结构

`runtime/` 包含预编译的 `#dafeiyu/*` 模块；`package.json` 只声明外部依赖，不包含 `@dafeiyu/` 私有依赖。发布包已通过：
- 私有包依赖扫描；
- 凭据/私钥/本地值扫描；
- 符号链接拒绝；
- 示例配置无身份/模型默认值。

## 4. 回退

- 保留上一版发布目录和安装记录；
- 新版本出现启动失败时，重建上一版发布包并在 DSH 插件管理器中恢复；
- 不删除 `.runtime`/安装记录，先收集 `server-runtime-status.json` 和关闭回执。

## 5. 结论

**发布包可部署**：构建、测试、冒烟、隐私检查和 npm 清单均通过。

**生产服务器尚不能直接判定可部署**：还缺目标环境的计费 authority 绑定、真实平台/模型验收和渠道回执对账流程；这些需要部署目标与凭据，当前未提供。
