# 7C保守计费实现与相关检查

2026-10-26。实现[已批准修订](integrated-7c2-bounded-cost-plan.md)，新授权文件独立保存，未改原授权hash、总预算或计时。

账本新增不可变的`cost.accounted-at-maximum`事件；原reservation仍为unknown、用量仍为空。统计将`usageBasedSpent`和`accountedAtMaximum`分别列出并合入`spent`，`actualCostUnknown`仍计数，只有尚未按授权足额计入的未知费用继续阻断。旧读取器仍看到原unknown并停止，不会错误放行。没有数据库迁移。

本机入口`--account-unknown reservation-uuid`核对授权、原首次调用及到期、原总预算和6小时额度。只允许已停止、没有在途或运行中场景、原预留与费用上界完全一致且没有超额用量的情况；同一记账幂等，冲突拒绝。其他未知请求不被连带豁免，不伪造供应商实际账单。

补齐账本内安全错误分类：代码、有效HTTP状态及供应商请求ID的hash；不存错误正文或思考。正式校准／批次仍通过原门槛。

相关检查25/25通过，含账本、计费、实际时钟限制、原授权、运行指纹及导出；构建和两组类型检查通过。测试是虚构传输，没有真实模型或平台请求。受管测试成功自动清理，报告见[JSON](results/integrated-7c2-bounded-cost-check.json)。未运行全量回归。

提交后对已确认的`e79387b8-e750-4270-ae5d-fd5465545a81`显式记入2.131072元，再继续同一账本校准。真实应用结果另附记录。现有`docs/memory-phase-1.md`未修改、不提交；没有服务器访问。
