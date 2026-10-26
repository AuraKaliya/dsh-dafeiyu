# R6a 命名外部执行授权检查记录

2026-10-26。R6a 已实现可选的精确 externalActions 策略、程序接口 authorizeExternalTask 及其真实调用生命周期 guard。原生 Task 需同时匹配扩展、动作与版本，并具有真实 QQ 主人任务或有效 wake／持久锚点来源；普通会话继续排除外部执行。外部动作调用本地写端口还需同一 policy.allowLocalWrite。旧策略缺省字段不回填，旧 Run／人格记录和 hash 不改。

根代理统一运行的相关组合为 **43/43 通过**：executor-policy 12 项、server-executor store 8 项、execution 8 项、execution-boundaries 6 项、activity-authority 9 项。实际报告为 `.runtime/test-reports/05f3721b-bede-4127-af2e-ae7a11894884.json`。这是该轮受管离线检查结果，不是全量回归或服务器验收。

后续静态复核发现，新 policy 的 actionVersion 虽按精确字符串比较、不具有通配权限，Schema 却仍允许通配符文本，与“无通配符”方案不一致。现仅将 ExternalActionPolicySchema.actionVersion 收紧为 `/^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/`，另拒绝首尾空白以关闭 JavaScript `$` 可匹配末尾换行之前的例外；不对输入做 trim 改写。已有公共 action 描述、授权描述中的 version 及其它全局版本契约保持不变。

现有首项测试已补充拒绝 `*`、`1.*`、空串、空白、Unicode、换行及超长版本，并接受 `1` 和 `1.0.0-alpha+1`。最后格式小修后，根代理运行 `npm test -- build-tests/executor-policy.test.js build-tests/server-standing-authority.test.js`，17/17 通过，其中本检查点 12/12，长期授权文件 5/5。报告 `.runtime/test-reports/3781ddb8-3d10-4e2d-81f4-227d2e810905.json`；成功临时目录已清理，清理阻断为空。

此前同一复测命令在构建阶段发现并行新增 IPC 文件的 `Process.send` 重载适配错误（报告 `123396dd-a376-411f-8b2e-fbfaadf80516`），当时没有执行测试。该接口以明确类型的包装函数修复后才获得以上通过结果；IPC 行为测试属于后续检查点。

本支线未自行构建、运行测试、提交 Git、付费调用或连接服务器。R6a 只证明此次授权边界；新 CLI 适配器、完整 bootstrap 装配、真实管理员身份及线上平台执行尚未由这组检查验收。
