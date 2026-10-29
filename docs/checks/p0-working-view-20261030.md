# P0：有边界的工作视图（索引稳定 / 能力索引 / 快照回收 / wire 探针）

日期：2026-10-30
范围：只做 P0。P1（统一装配与压缩）、P2（容量恢复与恢复文案）未实施；未改人格提示词。

## 修了什么

1. **待反思经历索引稳定化**
   - 模型可见正文改为由 pending 业务内容（排序后的 episode id/state/goal）生成的稳定 JSON；
   - 移除 `observedAt` 和随机 UUID；
   - item id、source ref、内容哈希由同一内容哈希派生；
   - `memory_context_snapshots` 按内容哈希复用，不再每次 prepare 插入新行；
   - 读取时间留给请求审计，不进入模型正文和版本哈希。

2. **能力目录压缩为“名称 + 简短用途 + 版本”**
   - 新增 `renderCapabilityIndex`；
   - `configured`、`callable`、宿主机工具、技能都只输出名称、120 字内用途和真实版本；
   - 技能不再携带完整 `load` 内容；
   - 运行环境路径、完整工具说明、技能正文退出常驻前缀，改为通过 `dafeiyu_capabilities`、`dsh_tool_list` 或技能加载按需查询；
   - 增加内容哈希 `version`，能力集不变时稳定。

3. **运行时上下文快照只保留最新一份**
   - 新增 `snapshotRetirementSeqs`：最新 carrier 保留，旧 carrier 全部退出模型工作视图；
   - 旧快照替换为很短的“已退出当前工作视图”标记，不再携带能力目录或其他大段 section；
   - 旧事件仍保留在 DSH 会话归档中，`priceRetirement`/`sourceEventSeqs` 保留来源与归档关系；
   - `retireContextCarrier` 与 `ContextRuntime.retire` 使用同一选择逻辑。

4. **只读 wire 投影探针**
   - `wireProjection` 从请求投影中移除本地 `source.sections` 元数据，保留正文、tools、toolHistory；
   - `inspectRequestCapacity` 同时返回：
     - `auditBytes`：本地内部对象/审计计量；
     - `wire`：投影后的请求字节；
     - `runtimeSnapshotCount`：当前请求中完整运行时快照数量；
   - 探针只记录，不改变现有容量限制和派发行为。

## 本机检查

| 运行 | 结果 | 覆盖 |
|---|---|---|
| `144a0acc-6d41-4447-bdcb-c2a384ae3c81` | 13/13 | 记忆索引稳定、能力索引压缩、快照只留最新、wire 投影、现有 context 快照测试、当前 API |
| `5c3d0d3f-bb52-40b1-89ab-8614e0b6faf6` | 40/40 | 当前 API、存储、记忆、检索、启动、运行时、native delivery |

构建：`node scripts/build.mjs` 通过。

说明：这些是模拟/本机测试，不是真实模型/真实 QQ/B站端到端验收；没有改正式部署，没有外发平台消息。`packages/plugin/src/prompt-catalog.ts` 由构建按当前源码重新生成，包含并行提交的提示词源文本，不属于 P0 人格改动。

## P0 尚未覆盖 / 交由 P1、P2

- 统一 `WorkingViewPlan` 契约与全区域预算（P1）。
- 压缩器覆盖运行时快照/能力目录，而不只是旧对话和工具结果（P1）。
- wire 字节与 token 预算的最终统一口径（P1）。
- 预派发容量失败后的重建与一次有限重试（P2）。
- 恢复模型普通正文的解析兜底与具体失败原因记录（P2）。
- 真实长任务、重启、来源撤回和正式部署复测（P0 后在正式实例验证）。

## 正式实例验证建议

1. 新任务连续多步后，`context.admitted` 的 `runtimeSnapshotCount` 应保持 1。
2. `runtimeContext` 字节不再随轮次线性增长；`wire.bytes` 与 `auditBytes` 的差异应稳定。
3. 待反思经历内容不变时，`experience-index` 的 id/hash 不变。
4. 能力上下文大小明显下降；完整工具/技能仍可通过按需查询获得。
5. 来源撤回后，最新工作视图立即不再包含相关材料。
