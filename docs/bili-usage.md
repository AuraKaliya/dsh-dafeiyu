# B站首版本地使用与边界

配置模板为`profiles/host.bilibili.example.json`。它声明QQ任务、兴趣探索、自主活动、记忆整理以及图像／ASR／声音事件依赖；没有创建活动计划，不会仅因启动就自动刷B站。

模板是虚构账号＋静态脚本模型，D盘工具路径与全零模型hash均为占位，不能据此声称已经可以真实观看。使用前替换为实际已安装工具、模型／词表hash和支持图像的真实路由；聊天与视觉使用Host中实际装配的provider。模型鉴权沿用Host独立凭据引用。当前没有真实模型费用或平台验收授权的恢复记录，不要直接拿模板当正式上线配置。

旧profile首次增加bilibili必须使用Host的migrate plan／apply／verify；不要用init重建已有目录。新profile按原Host说明初始化。B站运行库在core/bilibili.sqlite，media对象仍由media服务管理；原人格、记忆、QQ账本和活动计划保留。

默认匿名，只读公开内容。需要独立本机账号时，配置`bilibili.session.file`和`expectedUid`；会话文件结构是uid、SESSDATA及可选bili_jct、buvid3。通过本地私有文件管理，不能写入profile正文、Git、日志或聊天。本插件不自动登录／刷新，不搜索其它软件凭据，不复制服务器会话。每次API读取核验配置账号，媒体CDN／字幕不带Cookie。

| 目的 | 入口与返回 |
|---|---|
| 自主发现 | bili_discover；一页热门、下一页、pageId和观察 |
| 搜索 | bili_search_sources列来源；bili_search选择source及可选Unicode截取范围 |
| 视频信息 | bili_video；BV、aid、cid与分P、简介和局限 |
| 评论 | bili_comments；aid、排序、页码；parent读取根评论回复 |
| 字幕 | bili_subtitles；已曝光videoPageId＋cid，不传track列轨道，传track读取时间区间 |
| 弹幕 | bili_danmaku；同一六分钟段内[startMs,endMs)及offset，按返回游标继续 |
| 实际音画 | bili_media登记独立source；dafeiyu_media_read分别用frames＋pointsMs、audio＋interval |
| 长期保留 | bili_observe_select或dafeiyu_media_select；none／original／fragment／summary |

模型自己选择看什么、读哪段、是否继续和保留。搜索词来源是公开配置种子、当前Task看过的公开字段，或真实主人“任务：B站搜索：关键词”中的明确指示。自由拼接query当前不开放。普通兴趣聊天可先discover再选题；不会把其它私聊／群记忆直接拼成搜索请求。QQ兴趣资源由tasks.explorationResources显式列出，并且必须在qq-task策略resources中；默认旧配置不扩大权限。

source不是任意URL，也不是“已经理解”。DASH普通AVC／AAC是当前实现范围；缺音轨、无字幕、字幕／弹幕截断、格式不支持会保留缺口。已知付费／登录限制标记和DRM不绕过。新URL若没有强ETag区间证据，只允许在额度内完整读取；临时地址过期需要明确重新解析，不能把旧URL循环重试。

QQ任务结果经目标人格材料和独立核验后发送。B站没有评论、弹幕、私信、点赞、投币、关注或任意网络工具。媒体原字节的外发还受核心和media已有目标授权约束。

HTTP412／429及已知平台风控触发持久退避，默认15分钟；Host显示HOST_BILI_BACKOFF和截止时间，恢复不会自动试探接口。请求间隔默认1秒。默认最多保留4096份不可变页面，达到上限拒绝新页面并报告BILI_PAGE_CAPACITY；既有来源和回执不删除，需在维护时调整容量或设计有来源保留的归档。该限制是存储容量，不是每轮工具调用次数限制。媒体另有字节缓存额度和自动回收，运行库不属于测试临时目录。

当前实际完成的是本地程序开发、脚本模型与合成音画／回环检查。真实B站协议可用性、账号能力、音画理解质量、长期探索和资源开销须按整体验收另测。
