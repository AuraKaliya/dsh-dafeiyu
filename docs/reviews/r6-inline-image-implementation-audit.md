# R6 inline 图片模型接线静态审计

2026-10-26。AI 独立静态审查；只读项目源码、相关 diff、已安装官方包及测试。本审阅代理未构建、运行测试、访问服务器、调用模型或真实 HTTP。审查期间根代理修复了两项已反馈问题；初次结论以修复后的源码为截点。主代理随后实际执行的定向结果另列于文末。

## 结论

当前设计使用已安装 `@deepseek-ai/dsh-llm-deepseek@0.2.1-rc.2` 的公开 `DeepSeekAdapterOptions.resolveFiles` 接缝，保留官方 Messages 序列化与模型循环。对当前适配器请求调用图，InlineOnly 的拒绝发生在 Files 索引/网络路径之前，官方回退随后产生一次 inline Messages fetch；不会借 stale file-id 分支再派发。未发现修复后仍确定存在的 Files 旁路或重复 HTTP 阻断。

先前确定的启动阻断和凭据检查顺序问题均已由根代理改源；文末报告确认该组 6 项真实 Host/MediaAnalysis 离线测试已通过。该结论不证明真实模型图片理解、服务端计费或完整生产预算验收。

## 截点与依据

| 文件 | SHA256 |
| --- | --- |
| `packages/host/src/inline-model.ts` | `d44d921d9915b372103d72186a5ec96e5d67e4711dfddf2c1aec6b2f4849868b` |
| `packages/host/src/configuration.ts` | `c35d9fa2af774b65ab4eab32143f150da5ed6f2e60be1c6a516a10948b94f5ed` |
| `packages/host/src/runtime.ts` | `d448aeeb703bd3d5033311e791abc5f1e8ff95eb9401aa349a6992e6c8ca4f7a` |
| `tests/host-inline-model.test.ts` | `2bc7f9c745c405e7594c052f6e50962f59dce4cbf546d440678a40c524f22399` |
| `tests/host-inline-model-fixture.ts` | `589e4d826f8b8413c95d3fd2e04e76dc39854b8ff71882ec456afe2ea96cbb57` |
| `packages/media/src/analysis.ts` | `4fedafac1bbacb94d2b0256a7afc75a6d249c2564b12348c9e38a6165e244d78` |
| `node_modules/@deepseek-ai/dsh-llm-deepseek/lib/index.js` | `eba35025ed1eedda89c51f2da46a3a968f7be1d59719f2ceeadfc4518dff37d6` |
| `node_modules/@deepseek-ai/dsh-llm/lib/index.js` | `d18d8ae4c8d961e628708c1e4698e09716a0ebb80e55a672e0bde1029bec1155` |

公共类型依据为 DeepSeek 包 `lib/types/index.d.ts`、`types.d.ts`、`file-store.d.ts`。三者公开导出 Adapter、FileStore、resolveAdapterOptions，以及 resolveFiles/resolveAuth/admit 等构造依赖；没有深导入私有实现、修改 node_modules、替换模型循环或生产 global fetch。

## 两项具体发现及修复状态

1. **原配置必然在启动时失败，现已静态修复。** `resolveAdapterOptions`（官方 JS 410–422）默认 raw offload quantum 为 64 MiB、inline quantum 为 10 MiB、count quantum 为 20，并要求各值不超过对应上限。原 Host 仅传 raw/inline 最大 20 MiB、图片数最多 8，导致每个合法配置先撞 raw quantum 校验；默认 8 MiB 还会撞另外两项。根代理现明确传三个 quantum 等于对应有效边界，未降低官方校验或改库。现有 6 项 Host.start 测试会覆盖真实解析路径，尚未执行。
2. **原 credential fixture 的“零预留”断言与 Media 共享路径不符，现已补前置 guard。** Media 子 adapter 的模型信息解析只调用 host.resolveModelInfo，不执行官方 admit。原路径先进入 host.llm/stream 预算 hook，再在内部 prepareCall/admit 检查凭据；因此初始变更会零 HTTP，但可能已有一次保守预留。根代理现于注册 adapter 后安装 `{global:true,prepend:true}` 凭据 hook，Host 随后才 await 资金 installer。已读当前 `server-runtime/model-admission.ts`，其 hook 是 global 且不 prepend；Cordis waterfall 按登记列表由外到内执行，所以当前凭据 guard 位于预算 hook 前。admit/resolveAuth 的再次检查仍保留，以覆盖排队期间变化；不承诺排队后轮换也必定零保守占用。该修复亦未测试。

## Files 与 HTTP 调用图

- `DeepSeekAdapter` 构造器（2083 起）直接采用 `dependencies.resolveFiles?.()`；新工厂最后固定覆盖该依赖为 InlineOnly 实例，模型输入不能选择 store。
- 官方 `DeepSeekFileStore` 构造器（976 起）只分配 index/clock/fetch 字段与 in-memory Map。其 `DeepSeekUploadIndex` 构造器（810 附近）只保存路径；读取/写入在 load/get/commit/remove 等方法中。
- InlineOnly 覆盖 ensureUploaded，先检查 abort，再抛稳定错误，未调用 super；invalidate/release/reclaimOldestOwned/releaseAll 亦关闭。因此该请求不会进入 ensureUploadedOnce、index.get/commit 或 DeepSeekFilesClient。
- 官方 RequestFiles.resolve（1283 起）把这个错误包成 FileResolutionFailure；adapter.request（2169 起）仅将 inline=true 后重新序列化，首次循环尚未 fetch。
- inline 第二轮不再调用 prepareFileIds；Files occurrence 列表保持空。HTTP 错误即使描述 file-id expired，RequestFiles.retry（1320 附近）也因 used.length===0 返回 false。成功/截断 SSE 都没有返回 while 循环再次 fetch 的路径。
- 此处“一次”指一次已准入的 provider request；不等于限制整个 DSH Task 的工具步骤或总调用次数。
- 不触碰 Files reuse cache，不代表整个请求零文件系统活动：官方 anonymous user id 可能在受管 DSH_HOME 保存自己的 ID。测试只断言 Files 索引不存在，没有把该独立行为当成上传缓存。

## normal0、容量与凭据

- installInlineDeepSeek 固定 `retryPolicy:{mode:'normal',maxRetries:0}`；官方 Adapter.providerRetryPolicy 将它交给 LlmRuntime 注册。官方 llm 说明普通失败重试由可选 retry 插件执行，adapter 内部 stale-id 恢复另属上文 Files 路径；两者不能混为一谈。
- MediaAnalysis 的中间 MediaTransport 没有重写 providerRetryPolicy，自己的注册会取得默认 policy；但当前独立 Context 没装 retry 插件，且错误 finish 被映射为 MEDIA_ANALYSIS_FAILED。不能额外声称“所有中间 adapter 的注册值也都是 normal0”，当前静态图仍没有因此产生第二次 HTTP 的执行器。
- 只接受固定 provider、显式 off/low/high/max effort 和官方支持 image 的 catalog model；保留官方 contextWindow，只用精确比较验证配置值，不缩小声明容量来少预留图片输入。
- raw 图片和 base64 表示分别由官方 assertImagesFit 校验，超限先抛出而非隐式上传 Files 或直接丢图。maxImages 最多 8；inline 字节边界是官方 base64 表示边界，不能解释成可容纳同等数量原始字节。
- `maxOutputTokens` 通过 catalog/defaultMaxTokens 传入；官方 serialize 仍允许显式 request.maxTokens 优先。正式硬上限来自已读 `server-runtime/model-admission.ts:42–43` 的每请求检查，以及 SharedModelBudget 的 route 上限。不能把默认值设置本身说成 adapter 已拒绝所有更大显式值；本组假 budget hook 没覆盖该生产上限。
- baseURL 在 Host 配置层限制 HTTPS 或 loopback HTTP，拒绝 userinfo/query/fragment；官方 fetch 使用 redirect:error。凭据固定引用 DEEPSEEK_API_KEY，resolveAuth 要求 describe.source 为 file，并在 resolve 前后核对选定文件哈希；未采用环境变量作为候选回退，也未输出秘密。
- 凭据检查、图片租约和预算各负责自己的边界；它们不互相充当来源授权。新接线没有新增图片 host-path 暴露。

## 测试真实性与待验证范围

`host-inline-model.test.ts` 启动独立 Node fixture，受管 NODE_OPTIONS preloader 会为子进程创建自己的 worker/Temp 标识，非复用父 PID 的 testTempDir。fixture 在导入 Host 前设置自己的 DSH_HOME；使用真实 ManagedHost、官方 DSH Agent/Session/LLM/DeepSeekAdapter，以及产品 MediaAnalysis、MediaTransport、ScopedImages。

MediaAnalysis 的独立 Agent 真正经过 `MediaTransport → host.llm.stream → 准入 hook → 官方 adapter`；ScopedImages 租约由 AsyncLocalStorage 绑定到每次迭代，只有当前租约能返回原 PNG。fixture 的 fetch 替身解析官方真实序列化 body，比较两个 base64 PNG 与原字节相同，并拒绝 Files URL。返回值和模型结果是合成的；没有真实图片理解或真实 HTTP。

6 个场景分别针对正常 inline、stale file-id 错误、准入拒绝、字节超限、截断流、凭据变化。正常路径检查一次预留/结算、一次 Messages 替身调用、两图真实读取、零 Files 调用；拒绝路径检查无图暴露/无 HTTP；失败 usage 不完整保持 unknown。结果 JSON 的 realDsh=true、realModel=false、actualHttp=false、serverAccess=false 与夹具实现一致。

这些是直接 MediaAnalysis 集成检查，不包含完整 MediaService 资产读取/解码/来源证明链，也不包含生产 SharedModelBudget 真实金额账本、平台、真实模型或完整 7D。初次静态审计时尚未得到测试报告；后来取得的结果如下，合成返回的 images=2 仍不是模型识图证明。

建议根代理按原计划统一编译后定向执行这 6 项，并与生产预算专项分开记录。修复后若仍失败，应保留实际异常阶段和未派发/已预留/已出网的区分，不能以假响应替代未运行的链路。

## 后续实际定向检查

主代理统一运行报告：`.runtime/test-reports/b34e1d83-6368-4123-a41a-05b4bde2dfc7.json`。build、test-types、tooling-types 均 exit 0；组合 59 项中 48 通过、11 失败，零 skipped/cancelled。

- 本文 inline 组 6/6、Host hook 组 3/3、Host profile 组 12/12 均通过。对应两项接线修复得到本地实际检查支持。
- existing archive 为 4/10，6 项在 search trigger 校验处失败：实际 SQL 规范化去掉 `) VALUES` 的间隔，但期望常量没有做同样规范化。此存储支线已单独修正为两侧同一规范化，并保留严格语义比较，待定向重测。
- 另外 5 项失败属于 production runtime model admission / memory budget 组合，由对应代理处理；不将 inline 的 6/6 写成生产预算已通过。

该失败 run 按受管策略保留，报告记录约 26.3 MB、cleanup.blocked=[]；未自行删除现场或重跑。上述检查使用虚构凭据、合成响应和本地官方 DSH，未开展真实模型、平台或服务器验收。
