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

第 1 轮的生成失败和核验失败已放入 `native-delivery-interruption.test.ts` 与 `native-verification-interruption.test.ts`，测试名称明确标记 `R1.1 known gap`。当前断言用于复现“成果已存但交付恢复被终止状态挡住”，不是接受该行为为正确；R1.4 实现后必须将它们改为只恢复交付并最终送达的回归。

完整真实故事、真实核验采集、视频补读和故障恢复的独立证据适配、真实模型费用基线及两小时驱动仍待后续工作项完成。当前离线结果不能替代这些退出条件。
