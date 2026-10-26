# 服务器基础组件与额外插件：第二轮只读结果复核

2026-10-26。本文只复核根代理已保存的真实服务器报告，不另连服务器、不重跑广图、不运行DSH／模型／测试，也不终止任何进程。本文是AI证据分析与后续清单，不是清理执行记录或完整服务验收。

## 实际返回与证据范围

- 报告：`.runtime/deployment/server-foundation-dependencies-20261026.json`。
- SHA256：`d8a4739a9a73da6072faa9b60b05c8fbb88b49426c2cd772a8a354d32a8f7448`，本地独立复算一致；未二次读取服务器文件来重算报告内的各包hash。
- 报告采样字段为UTC 13:35:56.6794622—13:39:53.8381100，即北京时间21:35:56—21:39:53，约237.159秒。finishedAt在最终JSON序列化前生成，不含其后序列化／WinRM返回耗时。
- 根代理约21:54在尝试取消客户端等待时收到exit 0及完整JSON，并成功保存／解析。因此先前“尚未返回”的状态已过时，不能将本次定性为真无限循环、远端仍在运行或服务被强制终止。客户端后段等待的具体原因没有被本报告计时分解。
- 得到700个包节点、4896条边、92条unresolved；唯一issue为`package-limit`。这是完整返回的**有上限的报告**，不是完整依赖闭包。
- 分类复算为684个发行依赖可达、1个guard保护、15个待确认；700个节点全部`removalEligible=false`。`serviceDependencyClosureProven=false`，原始config、应用代码执行、远端文件写入标记均false。

用户范围继续有效：DSH自身官方基础功能、原软件文件与基础服务不可清除；只清理后来额外下载／配置的插件。不能按`@deepseek-ai`前缀、包名含experimental、当前disabled或未出现在已截断图中就判删。独立update-guard／maintenance、凭据及新增真实记忆均保护。

## 根链、基础版本与可用ABI路径

报告同时证明了两个物理发行根，包版本相同不代表同一模块实例：

| 用途 | 明确路径／版本 |
| --- | --- |
| CLI发行根 | `C:\DSH\app\node_modules\@deepseek-ai\dsh\package.json`，0.2.1-rc.2 |
| CLI可执行入口 | 上述包公开bin/dsh=`lib/bin.js`，即`C:\DSH\app\node_modules\@deepseek-ai\dsh\lib\bin.js` |
| 官方profile boot接口 | 包公开`./profile-boot`，类型`lib/types/profile-boot.d.ts`，实现`lib/profile-boot.js`；可据此做后续固定路径ABI核验，不能混用Desktop副本 |
| Desktop发行根 | `C:\DSH\desktop-app\resources\app\package.json`，dsh-plugin-desktop 2.0.18 |
| Desktop自带DSH副本 | `C:\DSH\desktop-app\resources\app\node_modules\@deepseek-ai\dsh\package.json`，0.2.1-rc.2 |
| Cordis | 两套发行根各有`node_modules\@deepseek-ai\cordis\package.json`，均4.0.5 |
| 官方基础bundle | 两根各有dsh-base、dsh-web-app、dsh-headless，均0.2.1-rc.2；CLI发行包有直接dependencies边到三者，Desktop根有直接边到base／web-app |
| 核心服务包 | 两根各有dsh-agent、dsh-agent-loop、dsh-session、dsh-session-persistence-jsonl、dsh-session-query-sqlite、dsh-system-prompt、dsh-tools、dsh-llm，均0.2.1-rc.2 |
| 冲突相关基础包 | 两根的dsh-compaction-basic、dsh-attachment-local、dsh-typert-registry／loader／protocol均0.2.1-rc.2，不属于可为内嵌方案卸载的市场插件 |
| 已有Node线索 | 第一轮`docs/results/server-inventory-20261026.json`记录运行路径`C:\DSH\runtime\node-v24.22.0-win-x64\node.exe`，ProductVersion 24.22.0；不是本轮重新取出的进程token或当前PID证明 |

`C:\DSH\app\node_modules\@deepseek-ai\dsh-base\cordis.patch.yml`明确声明agent、agent-loop、system-prompt、tools、llm、credentials、session-persistence-jsonl、session-query-sqlite、attachment-local、compaction-basic、typert等基础module，形成“发行根dependencies→基础bundle→module”的具体证据链，而非按命名推断。保留这些发行文件；本报告不证明所有可选bundle在当前进程已加载。

两个live profile的联接解析结果：

- `C:\DSH\DaFeiYu\运行状态\dsh-desktop\profiles\desktop\package.json` → `C:\DSH\DaFeiYu\配置文件\dsh-profiles\desktop\package.json`。
- `C:\DSH\DaFeiYu\运行状态\dsh-cli\profiles\headless\package.json` → `C:\DSH\DaFeiYu\配置文件\dsh-cli-profiles\headless\package.json`。

live profile到发行包的部分边为`distribution-fallback-candidate`，只说明静态候选位置；实际loader解析与runtime装配仍需定点核验。ABI工作优先固定CLI发行根及其公开profile-boot接口，不把本地源码包或另一发行根的同版本包当成实际执行实例。

## 15个待确认节点的精确清单

路径缩写：`P=C:\DSH\DaFeiYu`；`D=P\配置文件\dsh-profiles\desktop`；`H=P\配置文件\dsh-cli-profiles\headless`；`L=C:\DSH\desktop-state\profiles\desktop\node_modules`；`S=C:\DSH\desktop-setup\plugins`。表内路径均指该目录的package.json，不授权删除目录。

| 节点／版本 | 精确位置 | 根链与最小后续 |
| --- | --- | --- |
| dsh-browser 0.1.0 | `D\node_modules\dsh-browser` | desktop dependencies＋bundle；优先额外插件候选，核对浏览器能力是否仍被保留流程使用 |
| dsh-context 0.74.0 | `D\node_modules\dsh-context` | desktop dependencies＋bundle；file来源声明指向`S\dsh-context-0.74.0.tgz`，核对上下文功能替代和react-dom peer |
| dsh-skill-manager 0.1.3 | `D\node_modules\dsh-skill-manager` | desktop dependencies＋bundle；核对额外UI／技能管理声明，不连带删除官方skill基础包 |
| @dshd/dsh-usage 0.2.2 | `L\@dshd\dsh-usage` | desktop dependencies＋bundle；file来源声明指向`S\dsh-usage-0.2.2.tgz`，核对额外计量UI与实际计费账本边界 |
| @dsh-external/dsh-memory 0.5.0 | `L\@dsh-external\dsh-memory` | desktop直接dependency；file来源指向`S\dsh-memory-0.5.0.tgz`，profile本次无直接bundle边，不能据包自己的patch当作已启用；先核对存储归属，保护真实新增记忆 |
| @liustack/modsearch 5.10.10 | `L\@liustack\modsearch` | desktop dependencies＋bundle；优先额外搜索插件候选，不能顺带删除官方web工具或它们共享依赖 |
| whale-session-budget 0.1.0 | `S\whale-session-budget` | desktop直接dependency，未见profile bundle边；核对是否只剩旧辅助声明，不恢复任何按调用次数截断的旧规则 |
| dafeiyu-task-budget 1.0.1 | `P\程序\task-budget` | headless dependencies＋bundle；是旧CLI任务辅助，应先核对新父预算接管，不能把只计数插件当成实际费用控制 |
| dafeiyu-session-name 1.0.0 | `P\程序\dafeiyu-session-name` | headless dependencies＋bundle；核对是否还有会话归档／命名消费者，不直接归为市场清除项 |
| dsh-qq-bridge 0.7.2-dafeiyu.1 | `P\程序\qq-bridge-live` | desktop dependencies＋bundle；profile patch明确禁用id=qq-bridge，列为旧版本引用核对，不将disabled等同可删 |
| dsh-qq-bridge-v072 0.7.2-dafeiyu.1 | `P\程序\qq-bridge-v072` | desktop直接dependency，未见显式插入；核对旧链接及guard回滚／其它引用后才形成退役条目 |
| dsh-qq-bridge-v073 0.7.7-dafeiyu.1 | `P\程序\qq-bridge-v073` | desktop dependency＋profile显式插入，另有compatibility-qq根；当前兼容迁移对象，保留直到新QQ与23点流程接管核验 |
| dsh-bili-lite 0.3.3-dafeiyu.1 | `P\程序\bili-lite` | desktop与headless均有dependencies＋bundle，另有compatibility-bili根；先保留固定主人DM与账号／公开发布边界，不能只因新Bili读能力存在就删旧插件 |
| dsh-profile-desktop | `D` | live桌面配置容器，不是额外插件；后续只编辑精确附加声明，保留基础bundle与公共配置 |
| dsh-profile-headless | `H` | live CLI配置容器，不是额外插件；不要为清理附加插件删除整个profile |

因此可先形成**6个额外配置插件的局部核对候选**（表前六项），另分开审阅1个whale旧辅助、2个headless辅助、4个QQ／Bili兼容对象；最后2项是必须保留的profile容器。报告所有originClass仍为unknown，配置中的file/link说明可定位来源，不等于已取得完整市场安装历史；这些是下一步精确清单，不是13或15个“可删包”。

独立`dafeiyu-update-guard` 1.0.0位于`P\程序\update-guard`，唯一retain-protected节点；maintenance目录存在。守护本体／维护工具、状态与回滚材料均不纳入普通额外插件清理。

## QQ／Bili的公开接口证据

当前QQ 0.7.7的main与`.` export仍为`lib/host-v072.mjs`，另公开`./client`→`lib/client.js`及package.json。**目录名v073、入口名v072均不能取代包版本判断**；不能用旧0.6或0.7.2镜像覆盖现状。
Bili 0.3.3本报告只取得main=`./index.js`，未列独立DM或夜间版本API导出。公开入口存在不证明这些工作已被新产品接管。下一步如需兼容审查，只定点读取当前QQ入口／版本调度注册和Bili DM注册的公开代码或契约；不得运行import来探测，不读取真实聊天、cookie、session或历史正文。
23点记忆整理→增量日志→Git版本保存属于需要保留的实际流程；不能提前重跑、用初始化脚本替代，或以新Host启动成功宣称其已继续工作。

## 仍欠的证明与后续范围

92条unresolved可分为65条optionalDependencies、6条peerDependencies、17条module-declaration及4条按origin汇总的metadata-unavailable。多数optional项针对其它操作系统／架构，不等于Windows基础运行损坏；peer缺口仍需对真实消费者定点核对。
部分module缺口属于此静态解析器不支持包自引用／Desktop loader别名：例如报告中dsh-plugin-desktop、dsh-bili-lite和guard根节点本身已存在，却仍有同名module-declaration unresolved，不能据此宣布包不存在。4条origin汇总缺口也不能解释成4个根不存在，七个根节点实际均已取得；它们包含包数上限之后的后代未采集。
本轮700包上限、静态fallback和有限YAML解析意味着不能证明所有反向依赖或真实启用状态。后续只对上述候选的精确profile声明、解析实例、保留功能消费者与数据目录归属补证，并对QQ/Bili及夜间流程做替代验证；无需再跑全量广图或按名称批量清目录。
所有发行文件、原软件、基础组件与服务继续保留。只有局部证据足以说明额外声明及其依赖没有承担保留职责时，才由根代理形成具体的停用／替换／移除动作；共享依赖文件、用户数据、凭据、守护备份和新增真实记忆不能随插件一起删除。

本文确认本轮真实返回及其限制，不再沿用“可能仍无结果”的临时判断。Windows进程证明源码仍保持停写；本次只新增本检查记录。
