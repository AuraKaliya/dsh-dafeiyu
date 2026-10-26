# R6f3 B站固定主人 transport 与消费者租约

2026-10-27。实现前接口说明；本轮不连接服务器，不读取真实凭据、私信队列或会话，不执行模型、构建或测试。当前渠道/Store 的离线结果不代表平台已接通。

## 固定输入与加载

程序配置 `BiliOwnerProductionConfigSchema` 仅接受 `installationRoot`、`manifestPath`、`manifestHash`。manifestPath 必须是该根下 `配置文件/bili-owner-channel.json`，拒 UNC、链接/别名及越界路径。manifest 为公开部署记录，固定账号170759822、主人13461350，含正整数 generation、精确 authModuleHash、现有公开 bilibili.json 的 hash，以及旧消费者停用交接记录的 id/evidenceHash。

只接受已核对的 BiliAuth SHA256 `ae81e655b9f264de109ee3bc3377e8d722c89589c3e41d3cf218d712feab952c`，固定 `程序/bili-lite/auth.mjs`；它仅 import node:fs、node:path、node:crypto。读取完整校验后的字节再加载，避免校验文件与执行字节不同；不 import BiliAccount、HistoryStore、worker、index 或旧工具注册器。显式传 installationRoot，不使用默认 singleton 或环境变量 root。

账号身份 hash 与 bindingStamp 只依赖合同版本、固定双方 UID、generation；不含 PID、cookie、凭据字节 hash、轮询设置或公开能力设置。manifest/public-config/auth 的改变仍使当前 guard 拒绝；经重新核验接线、以新 pins 正常重启且 generation 不变时不制造新的来源身份。真正改变授权范围或归属才显式变更 generation/handover。

## 通信边界

公开导出 `createBiliOwnerProductionPorts(config, dependencies?)`；返回现有 `BiliOwnerPorts`。dependencies 只有程序侧 fetch 注入，用于无网络 fixture；普通 Host 入口不接 JSON 函数或模型替身。返回端口内部仅持有 BiliAuth 的最小 request/status/session 接口。

每次调用使用 AsyncLocalStorage 保存该调用的 signal、live guard 与是否已开始 POST。BiliAuth 的 fetch 只允许固定 nav、fetch_session_msgs、send_msg 三个 endpoint，严格核对方法、双方 UID、参数与实际发送正文 hash；不能发登录、公开评论、弹幕或其它对象请求。凭据固定在原根 `配置文件/凭据/bilibili.session.json`，只在该服务器进程内由已 pin 的 Auth 使用；路径/类型/大小/身份另行检查，不返回或打印头、cookie、正文异常。

读取合并 Auth timeout、调用取消与渠道关闭；限制响应字节与 JSON 深度。沿已观察的原响应格式在 JSON.parse 前保留不安全整数，绝不先 Number 再还原 ID。入站独立校验账号、双方、消息类型、时间、精确 ID/seqno 与分页游标；非文字只保留 unsupported 所需元数据，不造文字。

发送仅1000个 Unicode codepoint，拒非法 surrogate、空白和多余字段；不截断。只在最后 POST 前完成 guard；此前失败为 not-dispatched，一旦可能出网，断链、取消、风险响应、错误码或缺 msg_key 均为 unknown。收到与请求关联的精确 msg_key 才 sent；无自动重试或替换 requestId。幂等仍由既有 channel ledger 持久控制，不创建第二份发布账本。

## 同机消费者

`acquireBiliOwnerConsumerLease` 使用固定 Windows named pipe `DaFeiYu-BiliOwner-170759822-13461350`，地址不由 profile 指定。持有期间拒第二个新消费者；guard 检查 pipe 仍被本实例持有及部署 pins，release 幂等，进程退出由 OS 释放。epoch 取稳定 generation，不取 PID/nonce。普通开启不创建/修改交接 manifest。

这只约束本新实现。旧 worker、QQ 中的旧 DM 工具和旧全局工具不认识该租约；必须由部署交接核实停用并保存证据。manifest 的交接声明不是自动探测结果；不能用 lease 成功代替该核验。管道不是对管理员恶意进程的 OS 沙箱。

## 本批测试与后续接线

专属测试用 D盘受管目录、复制已核 hash 的公开 Auth 源码、虚构账号文件与显式 fetch 脚本。覆盖精确大整数、固定请求参数、错误账号/额外字段、无泄密稳定错误、取消和发送未知、hash/链接改变、cookie刷新身份稳定、两消费者互斥及退出后恢复。命名管道用例串行，默认 fetch 设为抛错来证明没有意外联网。

根代理负责 index exports 与 Host/server-runtime 装配；本子步不改这些共享文件，不新增平台发布权限。部署仍需服务器侧确认旧入口已停止、真实账号登录、目录ACL、public pins、generation/交接档案及真实主人入站/回复；不能根据无网络 fixture 宣称完成。
