# 本机任务：暂停原因与交付阶段修复

本轮仅本机开发及验收，服务器保持原冻结版本。人格、记忆、聊天和此前失败记录保留。

实际第八轮未合格：浏览器读取两条简介后受暂停限制，没有完成三视频画面和评论观察。暂停仍是原匿名 HTTP 风控；代码只在最近 100 条尝试中找故障原因，较早原因被挤出后错误扩大到浏览器。现直接查询仍生效的原因，并在既有 7 天／5000 条诊断回收中保留它。不解除原暂停；真正的账号或验证挑战仍共用停止条件。

同轮最终正文混淆了阶段通知和结果交付。已让经核验的本机主人委托进入原阶段反馈通路；程序提供明确的 intermediate-status-only 标签、结果交付顺序和已注册动作事实。阶段通知未送达不等于结果发送失败，已注册动作的暂停不等于缺少插件。结果仍经原人格整理、来源核验和真实 QQ 回执。

## 参考项目与取舍

仅阅读公开实现，未安装或执行第三方代码，未导入其人格／记忆／账号。参考版本固定如下：

- [humanism reader](https://github.com/InariNGT-Ofiicial/dsh-bili-humanism/blob/bb72cb2b2b6eb94d501076f429ad7b5a7ea5040f/lib/reader.mjs)：区分文字和抽帧覆盖；空文字不能证明没有语音，覆盖时长也不能证明理解正确。采用这种证据边界；继续使用大肥鱼现有 Media 与统一记忆流程。
- [scroll duty](https://github.com/c1overzz/dsh-bili-scroll/blob/2170499bb1aedf222874dbf2b6dadb65036681fa/prompts/duty.md)：兴趣选题、实际画面与评论、区分素材和指令、按真实回执判断交付值得借鉴。其“空转写即无语音”、固定调用次数、公开评论及独立报告人格流程不适用本项目，未移植。
- [whale session delivery](https://github.com/Alterssss/dsh-bili-whale/blob/8b0009f8ce2ebdc421afcb2e727b19ac18912ec6/lib/session-delivery.js)及 [scheduler](https://github.com/Alterssss/dsh-bili-whale/blob/8b0009f8ce2ebdc421afcb2e727b19ac18912ec6/lib/scheduler.js)：选少量再深入、串行交付及超时不等于未送达，与现有 Core 和 QQ 账本一致。没有新增独立调度器或第二人格。

浏览器能力说明补充多视频先取得各条抽样证据再深入、按实际时间点说明范围，以及不能仅凭评论文风确认人类或 AI 身份。未恢复工具次数上限。

验证：定向运行 browser、diagnostics、task-assessment、local-owner、qq-task-delivery，共 47 项通过。运行标识 30efe1c0-aa9f-402c-a2c2-21b1dc15c823，成功临时目录已清理。真实三视频后续另按行为、内容和 QQ 回执检查。单元测试通过不等于真实任务合格。
