# R6e：目标绑定的执行结果与来源连续性

2026-10-26。完成可选的 `ResourceProofProvider.targetView`、Core 校验和 Memory 原生结果整理接线；没有修改账号、数据库 schema、已保存的旧观察或旧人格。

目标许可不是 public 声明。提供者必须核验完整 proof、实际页面、当前 Task scope 和收件人，返回 reported/inference 及授权 stamp；Core 在返回前后检查 proof 当前有效。Memory 仍要求当前 Task 获准访问资源、观察仍有效且未被撤回/抑制。授权 stamp 进入目标材料指纹，变化后不能继续使用已准备的旧交付包。opaque 的原 Task 模型正文继续排除。

派生执行器正文通过程序侧 `inheritExecutionHistory` 继承活 Core 上下文的真实依赖；不能用模型给出的引用替换。缺少可核历史时拒绝记录，新的观察和其后续选择沿既有来源校验传播，不把模型自述变成没有上游的原始事实。旧外部原始观察默认仍用原有空 history 规则，旧对象 hash 不回填。

对于 targetView 许可的 inference，还需 Core 证明输入中没有无法归因的上下文/工具影响，且本轮没有被目标范围拒绝的候选材料。遇到其它私聊/群材料、未知 context、未知工具效果时，不以一张新许可页掩盖它们。无法全量重建的 continuity 摘要同样不能替代这项证明；此时可以保留明确安全的程序元信息，不能自动公开派生正文。固定来源的原有交付与已发布包读取规则保持。

## 实际检查

`server-executor-target-view` 6/6，通过真实 Core/Memory/QQ 回环夹具验证：原目标的 inference 可由新人格整理、其它目标拒绝、许可撤销、生成期间授权 stamp 改变、混合其它私密材料拒绝、已注册但无法归因的输入拒绝。原 QQ 任务交付 12/12 同时保留通过，涵盖独立忠实性检查、撤回、分段未知、发布接续和成长人格。

组合检查报告 `c6fa09e6-f61a-4016-925f-08da52609aa0` 中旧 QQ 12 项通过，但初版新夹具的四项失败。原因是夹具把完整 PersonaSourceRef 塞入严格的 ActionOutcome.sources，导致回执被拒绝；不能用这种失败工具的后续行为冒充来源验收。修正为正式四字段回执，并给全部新用例增加“实际操作 succeeded”前置断言后，仅重跑新文件 6/6 通过：`.runtime/test-reports/e6ff492e-2187-4ddc-ba9f-4d4271f27948.json`。中间失败 `9baffb3b-5843-465d-a939-27b90b180a79` 保留于受管轮替记录。

成功临时目录已自动清理，清理阻断为空。模型为脚本，QQ 为本机虚构 OneBot 回环，不是实际 QQ 发送或真实语义验收。完整 server-executor provider 的生产权限、真实 CLI 和管理员证明另记，不由本组夹具替代。
