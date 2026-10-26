# R6f-2b 固定 inline 图像通路检查

> 历史子步骤检查记录。2026-10-27范围收敛后，旧服务器接管/旧资金系统相关后续要求作废；当前实现与测试边界见 [清理记录](current-scope-and-cleanup.md)。本文只证明原提交和原测试，不自动覆盖新候选。

日期：2026-10-26。Host 的 `model-deepseek` 新增可选 `inlineTransport` 配置：输出上界、实际官方上下文容量、流空闲超时、inline 图像总字节和图片数。未配置的旧 profile 保持原行为与解析结果。

选择此模式时仍使用官方 DeepSeekAdapter、DSH 模型循环和媒体分析器；只通过公开的 resolveFiles 依赖选择一个拒绝文件上传/文件管理的固定实现。官方 fallback 把实际图像放在同一次 Messages 请求中。正常重试显式为零，文件 ID 列表为空，失效 fileId 不能触发隐藏的第二次 Messages 派发；不会改动官方 SDK 或桌面 profile。

配置同时给出与上限相容的三个 offload quantum，保留官方校验；超出 byte/count 边界即拒绝，不转回 Files、不丢图后声称已处理。凭据仍取官方 Credentials 中固定文件引用；在外层模型入口和实际 auth/admit 前核对文件摘要，不从环境变量回退。排队期间发生变化仍可产生一笔保守预留，不能将所有轮换都称为零占用。

## 实际检查

受管报告 `.runtime/test-reports/b34e1d83-6368-4123-a41a-05b4bde2dfc7.json`：

- inline 专属 6/6：正常双图；失效 fileId 错误只派发一次；准入拒绝时不取图/不派发；inline 字节超限；截断流保留未知；启动后凭据变更在新预留前拒绝。
- 同轮已有 Host 模型挂载 3/3、Host profile 12/12 通过，原配置、显式初始化、路径和租约规则保持。
- 组合运行共 59 项，48 通过、11 失败。失败属于新增 history schema 校验和 server-runtime 组件／夹具，正在分别修复；不能把组合运行或整个 R6f 宣称通过。

上述 6 项实际启动独立 Node、ManagedHost、官方 DSH/DeepSeek 适配器及产品 MediaAnalysis/MediaTransport/ScopedImages。测试端捕获官方序列化后的请求，验证两个 base64 图像逐字节等于原始合成 PNG；一次准入只出现一次 Messages 测试调用，Files 调用数和 Files 索引文件数均为零。

HTTP、模型结果和该组费用观察器为明确替身，真实网络请求为零。它证明实际代码路径与字节传递，不证明识图质量、完整 MediaService 来源/解码流程、生产 SharedModelBudget 的金额控制或服务器实例。后续须把实际共享预算与完整媒体链联合检查，再按原额度做 7D 真实验收。

首次构建因精确可选属性中的 undefined 类型不兼容停止，修正声明后构建通过并运行本报告；未降低 strict TypeScript。独立静态审查指出的 quantum 配置和辅助调用凭据检查顺序已修复，再取得本轮结果。源代码和检查材料入 Git；原未提交文档保持，临时文件继续仅在 D 盘受管目录回收。
