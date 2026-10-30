# B站改造进度复核与重复启动错误修复

日期：2026-10-31（北京时间）  
检查基线：`4eadd62`，包含检查开始时已有的三处未提交改动。  
结论：DSH 与实例启动已经恢复，实际插件已经切到 reading-final 包；本轮开发修复了部分旧缺陷，搜索、阅读记录和长任务接续仍未达到完整方案门槛。

## 本次启动修复

- `~/.dsh/profiles/desktop/package.json` 再次以 `EF BB BF` 开头。移除三个 BOM 字节后 JSON 可正常解析，其余字节未改动。
- 配置声明指向 `dsh-dafeiyu-0.25.0-reading-final-20261031`，pnpm 锁与实际插件链接仍指向 attention-v11。
- 正式 B站库已是 v4，旧版程序不能再直接打开。因此本轮统一声明、锁和链接到已存在的新包，没有恢复旧库。
- 新包导入检查、安装 `check` 和 `init` 均通过；用户重启正常。实例状态为 `accepting=true`、`error=null`。B站原有 `HOST_BILI_DIAGNOSTIC_REQUIRED` 保留，不能把启动恢复视作B站全部能力可用。
- 新增 `scripts/repair-dsh-profile.mjs`，默认检查；`--repair` 移除 BOM；`--repair --align-plugin` 在退出 DSH 后对齐本地声明、锁与链接。备份位于 profile 的 `.profile-repair/`，操作结果返回具体路径。
- 本轮新增三个部署检查用例，覆盖不写入检查、BOM 字节保留、链接对齐、备份及非法 JSON 拒绝。当前全部单元检查为 **336 项通过**，其中 DSH 原有 333 项、本轮新增 3 项；重复运行不另计。

操作前已有的 `execution-coordinator.ts`、`prompt-catalog.ts` 和 `execution-coordinator-harness.test.ts` 改动均保留。本轮没有修改B站、媒体或任务执行业务实现。

## 方案完成度

| 改造包 | 本轮确认的进展 | 结论 |
|---|---|---|
| A 任务收尾 | 完成/等待重新互斥，新增真实协调器测试与 continued 状态 | 基础收尾已修复；接续的崩溃一致性见 F |
| B 记录与迁移 | owner 参与记录索引；v2/v3→v4 显式迁移；身份先检查 | 部分完成；请求契约、事实装配、幂等回放和一致性备份仍有问题 |
| C 搜索与评论 | 关键词与结构化候选、分页字段、seen 上限有改进 | 未贯通；浏览器搜索在客户端仍被拒绝 |
| D 批量帧 | frames 已授权；null 等待态正常轮询；sources 多图入口和按共同来源分组 | 基础修复确认；逐帧视觉结果与服务级一次视觉仍需验收 |
| E 工具阶段 | 显式 toolStage、阅读动作白名单、关闭通用宿主入口 | 普通任务误判已避免；真实消息任务没有装入阅读阶段 |
| F 上下文与接续 | 新 session、continued、字节触发与有界视图函数 | 未完成；触发时机、交接来源、持久性、总预算与视图挂接存在缺口 |
| G 部署 | 候选包可导入、v4 数据可初始化；本轮修复配置与实际挂载 | 启动恢复；固定素材完整阅读和接续性能验收尚未通过 |

## 仍需修复的具体问题

### 1. 浏览器搜索仍必然触发旧的视频目标校验

`packages/bilibili/src/client.ts:51` 仍仅区分 discover 和 video。合法的 search 页面被计算成视频地址后拒绝，并可能记录为账号/绑定异常。当前工作区和实际部署包的这段代码一致。

隔离复现返回 `BILI_BROWSER_BINDING_MISMATCH`。修复需覆盖 service → client → browser → observation 全链路，不能只验证浏览器适配器的返回对象。

### 2. 阅读保存与工具请求契约不一致，旧请求回放也不是原回执

工具使用 `PersonaRequestIdSchema`，允许 `reading-1` 这类请求 ID；`BiliStore.saveReading` 却调用 `z.uuid()`，实际会拒绝合法工具参数。隔离复现已确认。

保存 first → 保存 second → 重放 first 的同一个 requestId，返回的是 second 的最新记录。收据表仅保存版本与视频，回放没有读取该版本的历史正文，也没有检查同请求参数是否改变。需按请求指纹返回原版本，参数改变时明确冲突。

### 3. 阅读事实生成仍读取旧数据形状

`readingFacts()` 在评论页顶层寻找 aid/page，但当前结果把这些字段放在 cursor 中；批量帧使用 points[]，函数却只读取旧的 capture。用当前结果形状复现时，评论实际存在但 cursor 为 null，批量帧实际存在但 frames 为 []。

此外，字幕请求 range 不能直接代表已经阅读整个区间；分页只返回部分 entries 时，应按实际返回和曝光区间记录覆盖。需要使用服务层实际返回对象验证事实生成，而不是另造一套不一致的测试对象。

### 4. 显式阅读阶段尚未进入正常消息任务入口

协调器只从 `saved.input.data.toolStage` 读取阶段，缺省 general。QQ 与本地主人受理工具使用 `MessageInstructionSubmitSchema`，没有 toolStage/data 参数；消息任务提交代码也没有程序分配阅读阶段。

因此手工 fixture 传 `data.toolStage=bili-reading` 可以通过，但正常用户布置B站任务仍默认 general。需要把经过验证的任务执行计划接入生产入口，同时保留普通任务的工具能力。

### 5. 接续交接不完整，且不是一个持久事务

当前代码分别写检查点、把父 run 改为 continued、再 submit 子 run。进程在后两步之间退出，会留下无可恢复子请求的 continued 父段。

submit 没有继承原 `messageSource`、`input.data`/toolStage 和根任务截止时间。子段可能失去最终交付目标，回到 general 阶段，并重新得到完整的单轮时限。需要一个原子交接入口和持久待派发请求，再验证中断恢复。

### 6. 预算与有界视图仍未约束实际请求

`boundedReadingView` 和 `segmentBudgetDecision` 目前只有定义与测试，没有进入生产装配路径。不能由“20 条记录的索引很短”推导“20 个视频后的模型上下文有界”。

NativeRuntime 的 contextAudit 发现超预算后仅置标记，当前模型请求仍继续发送，下一次 pre-step 才尝试退出。因此当前的所谓硬上限没有阻止超限请求。bytes/4 也不是可靠的实际 token 计量。

下一段仍携带父段操作列表，未形成方案要求的有限阅读工作视图；缺少原始时限继承、单视频也可接续、最小上下文仍超限时停止无收益切段的验证。

### 7. 迁移备份遗漏 WAL 中已提交数据

`migrateBiliStorage` 使用 `copyFileSync(file, backup)`，只复制主库文件；`migrateInstallation` 没有先取得运行占用锁。隔离复现中另一连接已提交 blocked_until=123456789，迁移仍执行，备份读取到的值却是 0。

应在确认停止实例并取得占用保护后使用 SQLite 一致性备份机制，之后再迁移和核对。不把单文件复制视作 WAL 库的一致性备份。本次没有恢复或覆盖正式数据库；这个复现不表示正式数据已经丢失。

### 8. 多图理解还缺少逐帧完成证明

共同来源分组替代了错误的完整 description 相等比较，sources 输入也已加入，这是有效修复。但 `readImages` 仍把第一帧的 source 作为批次主来源，输出仅含图像尺寸，未把每个输入帧的实际采样时间带入最终分析；观察结果只核对数量，未核对索引唯一性和范围。

需要真实媒体服务配合假视觉后端的装配用例，证明三帧产生一次视觉请求、每个结果绑定正确来源和时间点、重复索引被拒绝、取消释放租约。该用例可以在本机完成，不必以真实模型或平台访问作为开始条件。

## 本轮证据与限制

- 测试日志：`.runtime/bili-progress-check-20261031-0433.log`。
- 测试元数据：`.runtime/test-reports/7e7ce979-5b79-48f0-a28c-ad958c6473d4.json`。
- 隔离复现：`.runtime/bili-progress-repro-20261031-0433.mjs`；结果 `.runtime/bili-progress-review-20261031-0433.json`。
- 复现确认已修复：两帧各经历一次等待后成功，只导航一次；frames 授权存在；跨任务阅读记录隔离。
- 复现确认未修复：搜索校验、普通 requestId 保存、旧请求回放、评论/批量帧事实装配、WAL 备份。
- 复现未调用真实模型或B站平台。开发进度不以测试数量或函数存在推断。
- 已比较工作区构建与实际 reading-final 包的客户端、服务、store、浏览器、媒体和核心运行文件，业务内容一致。

下一轮应先关闭可复现的搜索/记录/备份缺陷，再接通消息入口的阅读阶段与原子接续，最后运行固定素材的完整阅读链并采集输入大小、导航次数、视觉次数及耗时。当前不能宣称完整开发方案已交付。
