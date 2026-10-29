# QQ 刷B站代码逻辑修复与本机检查

日期：2026-10-30（北京时间）
范围：只改代码逻辑，不改 QQ 人格提示词。没有连接真实 QQ、没有向 B 站发评论/私信、没有部署服务器。

## 修的三个点

1. **浏览器评论读取支持 `aid`**
   - `BiliBrowserRequestSchema` 现在要求 `bvid` 或 `aid` 二选一；discover 仍不接受任何视频标识。
   - `readBiliBrowser` 在只给 `aid` 时打开 `https://www.bilibili.com/video/av<aid>/`，允许 B 站重定向到规范 `BV` 地址，并把解析到的 BVID 写回结果。
   - `BiliClient.browserRead` 对 `aid` 请求接受“未解析出 BVID”或“解析出合法 BVID”，同时仍校验账号、section、请求 URL 和 frame 位置。
   - `bili_comments` 的工具说明明确：评论页返回的 aid 可直接用于浏览器评论读取。

2. **同一来源重读不再顶掉旧证据**
   - `BiliStore.page` 从“必须是最新来源版本”改为“该版本真实存在且可用”；新增 `BiliStore.valid`。
   - `current` 仍表示“最新版本”，保留原语义；`valid` 表示“历史观察仍有效”。
   - B站扩展的 `resourceProofs.current` 和 `publicView` 改用 `valid`；任务证据里的旧页面不再因为新版本出现而 `SOURCE_STALE`。
   - `readPage` 的父页面校验也改用 `valid`；浏览器 frame 图片的本地快照按 `valid` 保留，视频/音频流仍按 `current`。
   - 父页面、历史页面仍保留原 `sourceKey`/`sourceVersion`/proof，不删除、不改写。

3. **反馈策略：不中途主动播报，失败要说话**
   - 删除任务运行中 30 秒阈值后的自动 `progress` 调用；普通进展不再自动发 QQ。
   - `qq_progress` 的说明改为“只在确实卡住、无法继续或需要主人决定时使用”。
   - 执行规则改为“普通进展不必主动播报；卡住/失败/需要决定时才通过阶段反馈说明卡点、已完成的事和下一步”。
   - 失败通知的渲染 id 从固定的 `runId` 改为按状态生成的 `runId-failed`（失败时），不再被第一次进度占用的会话 id 挡住。
   - 失败通知的 Evidence 增加 `failure`（人类可读摘要、已完成操作数、未知效果数），并明确要求不输出内部错误码、不声称完成或已发送。
   - 正常渲染失败时增加一条保守的兜底人话：“我这边卡住了，任务先停在当前进度；已经完成的部分和记录都还在，我换个办法再继续。”兜底仍走原渠道与来源 guard。

## 本机检查

| 运行 | 结果 | 覆盖 |
|---|---|---|
| `062f2e59-37f5-465d-a1de-51b82cc28454` | 6/6 | 新增：aid→浏览器评论、重定向拒绝、契约二选一、客户端 aid 绑定、discover null bvid、旧页面在新版本后仍可读 |
| `36447614-4dd6-499d-821a-b6e6fda18768` | 19/19 | 上述新增测试 + B站基础、诊断、当前存储复跑 |
| `a1e1d455-51a4-47db-929b-e4a07341a9f1` | 14/14 | 当前 API、native delivery store、runtime store、tool receipt |

构建：`node scripts/build.mjs` 通过。
说明：这些是模拟平台/模拟浏览器与本机 SQLite 测试，不是真实 QQ→B站→QQ 端到端验收。没有运行真实模型、没有外发平台消息。

## 没做的

- 没有改 `profiles/persona.foundation.md`、QQ 表达规则、说话示例或任何“活人感”提示词；这部分按主人要求下一轮讨论。
- 没有连接本机正式实例做真实任务复跑；正式数据未迁移、未修改。
- 没有部署服务器、没有发布 npm/GitHub。
