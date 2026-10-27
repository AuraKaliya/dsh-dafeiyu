# 本机最终核验时限配置

第十一轮：三条视频各一帧实际视觉阅读和评论均完成，Core 独立评价 next=deliver、goalStatus=met，最终人格正文进入核验，但默认 30 秒到期后记录 DELIVERY_VERIFICATION_TIMEOUT；没有发送未核验正文，因此整轮仍未合格。

安装设置新增可选 phaseTimeouts，使用原 PhaseTimeoutsSchema 原样校验并传入 Host.runtime。未配置仍沿用原默认值；本机仅显式设置 verification=60000，处于既有允许范围内。没有把超时视为通过，没有关闭核验、放宽来源或重复发送旧正文，也未扩大每轮工具次数限制。

本机设置原件备份在私有 deployment/task-repair-20261028/settings-before-verification-budget.json。正常停止插件，使用 DSH 官方退出入口重启宿主，使新配置声明实际加载；不清空 data，不复制账号或凭据，不触碰服务器。

ad998053：安装配置传递、默认值／范围及 QQ 任务交付门控共 24/24 通过，成功临时目录已清理；真实任务仍须后续检查 QQ 回执与正文。
