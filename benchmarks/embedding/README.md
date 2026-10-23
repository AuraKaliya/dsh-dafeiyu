# 中文记忆 embedding 本机评测

本目录只包含离线评测程序和虚构数据，不是运行中的记忆插件。环境、下载权重和临时向量放在 Git 忽略的 `.runtime/embedding-bench/`。

## 预先确定的协议

- 对照 BAAI/bge-small-zh-v1.5 与 Qwen/Qwen3-Embedding-0.6B，下载时锁定模型提交 SHA。
- 同一份手工构造中文语料与相关性标签，冻结后记录 SHA256；不根据模型结果改写问题、相关标签或提示词。
- 使用各自官方推荐池化：BGE CLS；Qwen 最后一个有效 token；L2 归一化，精确余弦搜索。查询加模型推荐格式的检索指令，文档不加指令。
- CPU 与 CUDA 均用 float32、同为 8 个 CPU 计算线程、文档批量 16、单查询批量 1。不量化，不加 reranker，不调优模型。
- 输入统一上限 512 token，报告两模型实际 token 长度及截断数。该实验检验记忆片段，不检验 Qwen 长文本上限。
- 每个模型、设备在独立 Python 进程运行；加载后预热，单查询重复 3 轮、每轮以固定随机种子打乱顺序；性能不包含模型下载。
- 报告加载时间、实际参数、权重文件体积、建库耗时与吞吐、查询编码 P50/P95、进程 RSS 和 CPU 时间、CUDA 分配／保留显存峰值。RSS 为进程工作集，不等于独占物理内存；显存值不包含全部驱动和桌面占用。
- 候选在排名前按模拟 scope、删除状态及有效性过滤。过滤测试属于评测器规则验证，不归功于 embedding，也不冒充生产插件权限验收。
- 同时计算字符 n-gram BM25 基线以及预先固定的 BM25＋向量 RRF（k=60）。不根据结果修改融合参数。
- 主指标为宏平均 Recall@5；补充 Hit@1、Hit@5、MRR@10、分类型成绩及逐题排名。无答案问题不计入 Recall；报告其最高相似度，禁止把 top-1 当作有效答案或用本测试拟合拒答阈值。

## 选择规则（运行前确定）

优先以 BGE 为低资源默认候选。如果 Qwen 的 Recall@5 提升达到 5 个百分点，且 CPU 查询 P95 不超过 1 秒或本机 CUDA 查询 P95 不超过 100 毫秒，则优先选择 Qwen 并明确设备依赖；否则优先选择 BGE。模型如果 Recall@5 未达到 90%，不能宣称单路语义召回已满足首版目标；检查固定混合基线能否改善，并说明独立分析和关键词检索的必要性。

该门槛是本项目的初步工程选择规则，不是统计显著性检验。样本由本次评测作者构造且规模小，结论只适用于本机与这类短记忆；不代表线上长期分布、服务器性能、索引规模或下游回答质量。

## 复现

在项目根目录使用 Windows PowerShell：

```powershell
python -m venv .runtime/embedding-bench/venv
New-Item -ItemType Directory -Force .runtime/embedding-bench/temp | Out-Null
$env:TEMP = (Resolve-Path .runtime/embedding-bench/temp).Path
$env:TMP = $env:TEMP
& .runtime/embedding-bench/venv/Scripts/python.exe -m pip install --no-cache-dir torch==2.9.1 --index-url https://download.pytorch.org/whl/cu128
& .runtime/embedding-bench/venv/Scripts/python.exe -m pip install --no-cache-dir -r benchmarks/embedding/requirements.txt
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/embedding/download.py
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/embedding/run.py --model bge --device cpu
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/embedding/run.py --model qwen --device cpu
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/embedding/run.py --model bge --device cuda
& .runtime/embedding-bench/venv/Scripts/python.exe benchmarks/embedding/run.py --model qwen --device cuda
```

首次下载保存 `models.lock.json`；再次下载读取同一锁文件，禁止静默更新版本。评测加载本地 safetensors，关闭远程代码执行，不发送样本给模型托管服务，不读取真实 QQ、凭据或私人记忆。

本次实测完整依赖见 `requirements-lock.txt`，使用该文件可进一步固定间接依赖。`hardware.json` 保存本机硬件信息；四份结果保存在 `results/`。运行 `python benchmarks/embedding/verify_results.py` 可独立检查结果与样本的一致性；完整分析见 [本机评测报告](../../docs/embedding-benchmark-2026-10-23.md)。

官方用法参考：[BGE](https://huggingface.co/BAAI/bge-small-zh-v1.5)、[Qwen](https://huggingface.co/Qwen/Qwen3-Embedding-0.6B)。
