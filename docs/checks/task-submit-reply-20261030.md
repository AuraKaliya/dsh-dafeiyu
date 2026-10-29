# 修复：任务受理后不回复 / 会话循环

日期：2026-10-30
触发：用户发送十分钟 B 站学习任务后，QQ 没有收到任何确认。

## 现象

- 消息已进站，任务已创建：`dbc85b4f-0955-4cab-b53b-4d8439255e27`。
- 任务 run `bb5d53a8-9e96-41f3-8b33-4f825d3a3cf1` 在运行，已取到若干 B 站视频与评论。
- 会话 run `6824c6bb-1ba3-4ace-9abb-b3510de0cb9f` 在受理后没有结束：继续调用 `dsh_tool_list`、`dafeiyu_capabilities`、`qq_task_status`、`bili_status`，并尝试 `bili_discover`，进入受理后循环。
- 旧逻辑在“任务已受理但没有文本”时，会把 inbound 标成 `handled` 并带 `replySuppressed:'accepted-task'`，因此 QQ 完全看不到确认。
- 不是上下文容量问题：`context.admitted` 约 148–292 KB，`runtimeSnapshotCount=1`，无 `context.repair`。

## 修复

1. `qq_task_submit` 工具说明增加硬约束：
   - 受理成功后必须结束本轮，只写确认；
   - 不再调用 B 站、任务状态、能力查询或其他执行工具；
   - 不自己执行任务或轮询进度；
   - 实际结果由独立任务交付。
2. `dafeiyu-execution-rules` 增加同样约束：`qq_task_submit` / `local_owner_task_submit` 成功后立即停止调用工具，写一小段确认并结束。
3. `conversation-run` 的投影不再把“已受理但空回复”静默标成 `handled`：
   - 空回复且已委派任务时，生成确定性确认：
     `任务已受理，正在后台执行；完成后把结果发给你。`
   - 事件记录 `replyFallback:'accepted-task'`，便于区分模型正文和程序兜底。

## 本机检查

| 运行 | 结果 |
|---|---|
| `781dc9ce-6d19-4e2e-8e89-f601e77bc622` | 18/18 |
| `316978b6-1b34-41ab-937f-14acb6d02957` | 51/51 |

构建 `node scripts/build.mjs` 通过。

## 限制

- 当前已经卡住的会话 run 不会被热修代码追溯修复；需要重启后重发。
- 该修复降低“受理后继续调工具”的概率，并在空回复时保证有确认；不保证模型永不循环。
- 真实 QQ 端到端仍需重启后复测。

## 部署

热修文件：`core`、`channel-qq`、`plugin` 的 `lib`。部署后需要重启 DSH / 大肥鱼实例；当前运行中的任务会被中断。
