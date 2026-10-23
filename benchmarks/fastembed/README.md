# 现有 FastEmbed / ONNX 向量契约本机验证

本实验只在本机运行，复用 `../embedding/dataset.json` 的100条虚构材料和47个查询，不读取真实记忆或既有向量缓存。服务器仅接受只读源码／模型指纹核查；不向在线服务发送推理请求，不修改或重启服务器。

## 预先确定的验证范围

1. 从公开的 Qdrant 模型仓库下载 ONNX 文件；模型及分词配置逐文件 SHA256 与服务器比较。锁定仓库 revision。
2. 本机独立虚拟环境安装服务器同版本 FastEmbed、ONNX Runtime、tokenizers、NumPy、FastAPI、Pydantic、Uvicorn 和 HF Hub；不安装 Torch。
3. `reference/embedding_service.py` 是只读取得的现有公开程序代码，指纹与服务器一致。仅导入 `create_app`，显式注入指向本机模型目录的 Runtime，不执行 launcher、不启动监听、不复制或运行缓存数据库代码。
4. 使用 FastAPI TestClient 驱动原服务真实模型与HTTP路由，在进程内完成请求。测量包含ASGI请求/JSON处理，不包含网络socket或服务器调度；不能称为线上端到端延迟。
5. 对比 raw（查询原样）和 prefixed（客户端在查询前加 BGE 中文检索指令）两个独立进程。文档始终原样。线程1、批量8，与现有服务契约一致。单查询预热后重复3轮。
6. 同时验证512维、有限值、归一化、输入输出顺序、单条/批量一致性、float/base64一致性、usage、错误请求、健康状态。先定容差：浮点向量绝对差<=1e-5，范数误差<=1e-4。
7. 超长输入测试区分字符请求上限与512-token截断行为，不把HTTP接收成功当作全文均已编码。边界与拒绝测试使用虚构文本。
8. 资源报告进程RSS及Windows private/commit峰值，采样20ms，并读取OS进程高水位；分别记录常规短文查询和长输入批量压力阶段。长输入压力为20批、每批8条、每条约1000个汉字，不并行启动其他模型。
9. 重复原有精确排名、范围过滤、BM25及固定RRF，重新计算相同指标；不修改样本或相关性标签，不用本轮成绩调参。
10. 比较ONNX与之前PyTorch实现的实际向量距离：本机重新计算相同短文本，报告误差，不预设同名同维等于字节兼容。

## 2 GB预算口径

服务器总内存4GB；2GB是本轮为大肥鱼相关开发/部署规划的工作预算，并非“整台服务器只有2GB”，也不是承诺已有2GB空闲。

目标是共享单实例现有embedding服务，不给主插件、每个群或分析任务重复加载模型。对新增进程同时统计峰值RSS和提交内存；若本机嵌入服务进程峰值超过512MiB，将其列为需要优化的预算风险。剩余资源分配必须依据DSH/QQ/缓存/记忆索引的组合测量，不以单模型通过代替整套系统在2GB内验收。

本文仅规定本轮测量的初始检查门槛；不向在线进程施加内存上限，不改变缓存或推理并发。

## 复现步骤

在项目根目录执行：

```powershell
python -m venv .runtime/fastembed-bench/venv
New-Item -ItemType Directory -Force .runtime/fastembed-bench/temp | Out-Null
$env:TEMP = (Resolve-Path .runtime/fastembed-bench/temp).Path
$env:TMP = $env:TEMP
& .runtime/fastembed-bench/venv/Scripts/python.exe -m pip install --no-cache-dir -r benchmarks/fastembed/requirements.txt
& .runtime/fastembed-bench/venv/Scripts/python.exe benchmarks/fastembed/prepare.py
& .runtime/fastembed-bench/venv/Scripts/python.exe benchmarks/fastembed/run.py --query-mode raw
& .runtime/fastembed-bench/venv/Scripts/python.exe benchmarks/fastembed/run.py --query-mode prefixed
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/fastembed/compare_torch.py
python benchmarks/fastembed/verify_results.py
```

模型锁、服务代码指纹和依赖记录随结果保存。首次制作manifest依赖本机已保存的只读核查结果；已有manifest与reference时复现无需连接服务器。只读代码快照用于本机验收，不是部署覆盖材料。

compare_torch.py 使用上一轮已经准备的独立Torch环境，并在两组ONNX资源测量结束后执行，不影响内存测量。已保存的跨运行时比较不通过1e-5逐元素严格等价阈值，不能据此混用索引。详见 [完整结果与部署方案](../../docs/fastembed-compatibility-2026-10-23.md)。
