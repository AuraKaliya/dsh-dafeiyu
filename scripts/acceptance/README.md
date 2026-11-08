# 修正版离线验收入口

本目录对应[修正版开发计划](../../docs/plans/corrective-development-plan-20261107.md)的第 0 轮首批资产。当前入口仅运行真实 SDK 加脚本模型的隔离场景，不调用真实模型、平台或账号，也不启动部署及两小时观察。

## 运行

在源码根目录已有开发依赖的环境中执行：

```powershell
npm run test:acceptance
```

默认创建 `.runtime/acceptance/<时间和运行ID>/`。也可以指定一个尚不存在的目录：

```powershell
npm run test:acceptance -- --out .runtime/acceptance/my-first-run
```

入口调用现有受管理测试运行器，完成构建、类型检查和选定的 SDK 场景，沿用临时目录、进程及清理规则。已有目录拒绝复用；不会覆盖旧运行。模型始终为 `local-test/scripted`，QQ 渠道和B站响应由夹具提供。没有实时模式或真实账号参数。

| 场景 | 执行对象 | 独立审计重点 | 覆盖边界 |
| --- | --- | --- | --- |
| patrol-new | 新任务修改原巡视计划 | 原 ID、新版本、周期、水位、自等待、隔离和发送 | 脚本模型；不证明真实模型会选择同一路径 |
| patrol-amend | 修订原任务中的原计划 | 增加同 Task 检查，复用原有授权回归 | 同上 |
| owner-report | 主人任务读取群消息并三稿修订 | 原业务读取不重复、候选生成与核验请求数量、实际目标和送达 | 脚本核验；不证明自然语言事实判断 |
| dsh-result-read | 真实 DSH 结果归档与读取 | 实际源码行内容及覆盖，不依赖调用函数名 | 不是宿主工具执行，也不是完整诊断 |
| video-reading | 八条合成视频资料与阅读记录 | 同 Task、记录数量、读取次数、上下文及请求账本 | 没有真实字幕、画面或音轨，不代表完整观看 |
| delivery-render-recovery | 生成故障后管理入口恢复 | 同任务与交付、持久请求、业务读取一次、最终送达 | 有效材料内的发送前恢复，不覆盖过期续期 |
| delivery-verifier-recovery | 核验故障后主人 retry | 同候选及证据、生成不重做、重启不重复发送 | 脚本核验，不证明真实语义可靠性 |
| fault-notice / execution-fault-notice | 交付或执行失败后的系统通知 | 原目标、持久通知回执、零额外通知模型调用 | 业务请求仍使用脚本模型 |
| fault-notice-unknown | 通知渠道抛异常 | 未知回执、一次尝试、没有备用重发 | 不证明用户实际收到 |
| task-send-text / task-send-media | 文字或文档附件部分发送后接续 | 原批准正文/媒体、剩余分段、无重复获取与模型调用 | 隔离渠道与合成文档 |
| task-send-not-sent / task-send-unknown | 确定未发与未知效果对照 | 仅确定未发恢复，未知不重发 | 未查询真实平台回执 |
| diagnostic-flow | DSH 诊断到交付 | 读取当前实际源码、返回字节与摘要、目标判断及回执分开 | 隔离 DSH 端口，不是实际桌面权限验收 |

场景及判据在 `catalog.ts`、`audit.ts` 中版本管理。运行输出的 `passed` 只表示这个离线子集；`releaseAccepted` 始终为 `false`，全部业务要求的最终验收仍单列为未执行。

## 证据与复审

每轮保存以下文件，均为 UTF-8 无 BOM；JSON 通过同目录临时文件替换写入：

- `manifest.json`：运行 ID、源码修订与内容摘要、驱动摘要、离线配置及场景清单摘要、版本、判据版本和开始时间。
- `configuration.json`：离线模式与模型设置。场景具体配置在已纳入驱动摘要的测试夹具中；该文件不是正式实例完整配置。
- `<场景>.json`：夹具从本轮实际存储读出的计划、运行、交付和模型账本，以及模拟渠道实际接收的正文和请求字节测量。
- `completion.json`：结束时间、测试进程退出码、结束时源码/驱动/运行代码摘要、各证据文件摘要。
- `audit.json`：独立条件检查、失败或未执行场景、覆盖限制及当前审计程序摘要。
- `baseline.json`：按场景组织的请求和字节基线；无供应商 token 时保持未知，不生成费用金额。
- `tests.log`：构建、类型检查和所选程序回归原始输出。

夹具收集接口只在验收入口给定本轮目录和运行 ID 时启用。普通 `npm test` 不写这些档案。每个场景只允许写一次，来源和驱动摘要变化时拒绝收集。受管理测试的临时库清理前完成合成证据归档；不读取生产库。

复审保留原报告并追加带时间的报告：

```powershell
node scripts/acceptance/audit.ts .runtime/acceptance/my-first-run
```

证据按原运行绑定及内容摘要核对。复审程序摘要与原驱动不同时标为 `re-audit-different-driver`；这不能补造原运行缺失的业务证据，也不表示旧运行重新执行。

## 核验样本回放

`tests/fixtures/acceptance/verifier-cases.json` 保存八个脱敏样本，包含正确限定、错误断言、真假混写、视频采样范围及保留改写样本。`expected` 是预定人工判据，不是模型实测结果。保留样本不用于调提示词。

`replay-verifier.ts` 仅消费已经收集的响应，不发起模型调用。响应档案的格式为：

```json
{
  "schemaVersion": 1,
  "casesHash": "样本集解析后的SHA256",
  "mode": "recorded",
  "observations": [
    {
      "kind": "response",
      "caseId": "cache-does-not-prove-absence",
      "requestId": "该次响应的真实请求标识",
      "inputHash": "deliveryVerificationBody生成内容的SHA256",
      "response": {"checks": []}
    }
  ]
}
```

上例只展示结构，空 `checks` 不会通过。失败记录使用 `kind: "failure"` 和错误 `code` 替代 `response`。同一请求或样本重复、输入变化、遗漏样本、服务错误和格式无效均不能算作“正确拒绝”。`scripted` 仅验证程序控制流；`recorded` 的真实请求身份和原始采集仍需另行核对。

```powershell
node scripts/acceptance/replay-verifier.ts <响应档案.json> <新的报告.json>
```

报告分别统计误放、误拒、不可用、未执行和无效结果，并明确 `realModelCalled: false`、`semanticReliabilityProven: false`。缺少真实采集或有绑定错误时，不能以此报告宣称真实语义核验通过。

`wait.ts` 提供后续业务驱动使用的阶段等待函数：有真实阶段截止时间时优先沿用；没有截止时间时才使用验收侧的无进展诊断时间。它已有 322 秒合法完成、真实超时及取消的回归；当前离线 SDK 场景仍沿用各自测试运行方式。它没有修改业务任务时限，也没有替换尚未纳管的历史付费驱动。

## 继续开发

第 1 轮的生成失败和核验失败位于 `native-delivery-interruption.test.ts` 与 `native-verification-interruption.test.ts`。0.28.8 已将原 `R1.1 known gap` 改为成功恢复回归。0.28.9 再加入统一状态、系统通知、文字/媒体发送接续及实际源码诊断，判据为 `corrective-offline-3`，包含十五个离线场景。取消、撤权、三稿上限和真实进程退出另有回归，不能用测试数量替代需求覆盖。

0.28.10 的 `corrective-offline-4` 保留上述十五个场景，加入 `context-folding`。固定基线为 `tests/fixtures/acceptance/context-baseline.json`，由 0.28.9 在实现前测得；不重新生成基线使新代码通过。`context-audit.ts` 独立核对十四次任务请求、十二份材料首次暴露、纠正/禁止/待办、一次归档回查、最终相同报告、百万容量及输入账本，再比较重复正文和总输入字节。费用仍为未知。批量回查、重启、来源失效和大文本解析另由程序回归覆盖。

本版修正一项验收器误拒：配置任务尚未结束时，必须等待来源任务，但前台确认此时可以已结束。审计继续检查 sourceState=pending、调度未提前执行、原计划 ID/版本/水位；不再把 foregroundBusy 必须为 true 当作业务条件。已补“前台空闲但来源仍 pending 可接受”和“仅前台忙碌不能替代来源 pending”的正反例。

完整真实故事、真实核验采集、视频补读和故障恢复的独立证据适配、真实模型费用基线及两小时驱动仍待后续工作项完成。当前离线结果不能替代这些退出条件。

## 本地性能与取消恢复

`npm run test:performance` 在新的 `.runtime/performance/` 目录串行运行 64 次读取、运行中管理取消、缓冲流取消和真实子进程退出恢复。保存源码/驱动摘要、固定阈值、原始测试日志、CPU 采样及 `audit.json`；基线来自 `tests/fixtures/acceptance/heavy-baseline.json`。比较同时启用 CPU 采样的前后样本；普通并行回归不把机器资源竞争当成耗时门槛失败。

性能审计要求同样的业务读取和最终正文、最长事件循环延迟低于 1 秒、取消受理低于 1 秒、取消结算低于 1.5 秒。恢复使用原数据和身份，不初始化空库；不得增加模型请求或重执已完成读取。命令不调用真实模型或平台，`releaseAccepted` 仍为 false。`performance-profile.mjs` 可只读分析已有 CPU 采样的指定时间窗口；栈包含时间存在重叠，不能直接相加。
