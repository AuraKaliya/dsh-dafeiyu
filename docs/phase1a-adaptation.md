# 第一阶段1A：适配前提验证

日期：2026-10-24。功能开发基线`36d00fe`，工作分支`phase-1-core-host`。本步仅新增隔离探针、虚构样本生成器、验收记录及测试依赖；现有core、QQ、memory运行行为未修改，服务器未连接。

## 结果与验收层级

| 探针 | 实际结果 | 证据层级与限制 |
|---|---|---|
| P1-P01 程序来源 | 通过 | 真实DSH＋脚本模型；自定义生产者来源经过followup、JSONL关闭重开、冷查询、来源追踪、surface替换和resume保留。验证DSH压缩使用的替换／回查机制，不冒充新任务压缩策略已经实现 |
| P1-P02 模型持久化 | 通过 | 真实DeepSeek模型＋真实DSH；两次依赖前次回执的工具调用，关闭宿主后恢复并执行第三步；5次提供方请求。5个reasoning块及5份opaque replay在DSH持久化前退出，实时／恢复／磁盘检查均无私有模型状态 |
| P1-P03 图像输入 | 通过 | 真实模型＋本地生成PNG；无图负例返回NO_IMAGE，有图时六格颜色／形状全部正确，DSH适配器实际请求图像字节。不是把图片描述作为文字传入 |
| P1-P04 实际音频 | 通过 | 本机CPU Whisper tiny＋YAMNet ONNX真实推理；中英文系统合成语音，无字幕输入，均识别蓝灯／三次／关闭关键事实并提供时间戳；已知非语言提示音与Speech被识别，处理覆盖音频尾部 |

真实结果：[运行与持久化](results/phase1a-runtime.json)、[图像](results/phase1a-image.json)、[音频](results/phase1a-audio.json)。原始隔离会话、图像、音轨、模型和尝试记录留在Git忽略的`.runtime/phase1-probes/`。这些是小样本适配验证，不是正式人格、任意音频质量、完整视频或服务器资源验收。

本步`npm test`全量425项通过，0失败、0跳过，包括4项新增适配测试；真实模型／媒体探针通过情况单列于上表，未混入这425项数字。

## 按用户指定顺序核验模态

1. 只读取本机DSH当前绑定的非敏感模型字段，路由仍为`deepseek-official / deepseek-flash / max`。DSH实际解析的inputModalities是`text,image`；当前通路没有声明audio。
2. 官方[图像文档](https://api-docs.deepseek.com/guides/vision/)确认Flash支持图片；以本项目真实DSH通路验证成功。未向未声明音频的聊天接口伪造音频输入。
3. 查询`dsh-plugin-catalog@2026.1024.9903`，目录6704条，关键词粗筛250个候选；随后读取候选作者仓库／发布包，而不是仅凭市场简介断定可用。
4. 采用市场参考中的本地轻量引擎，在项目隔离目录测试；未安装到桌面profile，没有变更既有DSH服务。

| 参考 | 核查结论与本步采用 |
|---|---|
| [dsh-ears](https://github.com/WizisCool/dsh-ears)，发布包0.4.3 | 使用`@fugood/whisper.node@1.1.3`；本步只在隔离目录使用同版本CPU引擎，未安装其前端或改桌面配置 |
| [dsh-audio-read](https://github.com/liyixuan201211/dsh-audio-read)，提交`11ce38969e9b1a0b0e45b6429fa33e81623d4a55` | 声音事件层采用YAMNet ONNX；其MLX语音路径不适用于此Windows环境。本步独立实现小型WAV探针，不复制其完整脚本或把其性能自报当本机测量 |
| [dsh-watch-video](https://github.com/zeshuochen/dsh-watch-video) | 可参考转录任务、取消和产物管理；字幕优先／large-v3方案不等于本项目首版音画理解，也不是本次轻量引擎选择 |

Whisper权重约77.7MB，YAMNet权重约16.1MB；确切版本／SHA256见结果和准备脚本。语音推理约4.3秒／段，观察到的Whisper进程RSS快照约301—380MB；不是组合峰值或2GB整机认证。音频识别有局限：中文专名“大肥鱼”转写为“大飛魚”，关键事实通过不代表逐字全对。YAMNet分数是模型输出，不能当成已校准概率或任意声音理解能力。

## 实现与复现

- `tests/phase1-probe-fixture.ts`：独立DSH入口、自定义程序来源、可见流投影、探针工具与安全结果检查。未替换现有DshRuntime。
- `tests/phase1-probes.test.ts`：来源关闭重开、替换后回查、实际DSH多步工具、reasoning／replay剔除与畸形流拒绝。
- `tests/phase1-image-fixture.ts`：只接受一个已知本地生成PNG的附件后端；不是生产图片解码器或任意文件读取服务。
- `scripts/accept-phase1-runtime.mjs`、`accept-phase1-image.mjs`：沿用现有DSH凭据服务，隔离目录，关闭时核验凭据文件未改变；不输出密钥或内部思考。
- `benchmarks/phase1/`、`scripts/accept-phase1-audio.mjs`：本地系统TTS生成中英文虚构音轨，Whisper实际转写，YAMNet逐窗口识别；无麦克风、私人音频或字幕。

```powershell
npm.cmd test
npm.cmd run accept:phase1-runtime
npm.cmd run accept:phase1-image

# 隔离安装，仅CPU，不运行包安装脚本；权重不入Git。
npm.cmd install --prefix .runtime/phase1-probes/audio-node --save-exact --ignore-scripts --omit=optional @fugood/whisper.node@1.1.3 @fugood/node-whisper-win32-x64@1.1.3
node scripts/prepare-phase1-audio.mjs
& "$env:WINDIR/System32/WindowsPowerShell/v1.0/powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File benchmarks/phase1/prepare-audio-fixtures.ps1
npm.cmd run accept:phase1-audio
```

音频事件探针复用已准备的`.runtime/fastembed-bench/venv/Scripts/python.exe`，只需要该环境已有的numpy／onnxruntime；不安装Torch、librosa或大型音频语言模型。其它机器先按[已有FastEmbed复现说明](../benchmarks/fastembed/README.md)准备依赖。当前脚本针对本机Windows探针，不能当成跨平台生产部署工具。

## 发现与修正

- DSH会话header要求绝对cwd，探针改用当前项目绝对路径；没有改变DSH校验。
- Query返回的trace字段位于返回对象自身，按安装版本类型修正调用；没有用any绕过类型检查。
- Windows PowerShell 5读取带中文的脚本需要正确编码；语音生成器使用UTF-8 BOM，未改变系统执行策略。
- Whisper发布包README示例使用`model`，实际1.1.3原生接口读取`filePath`；按发布源码核实后修正。本次初始准备失败保存于音频attempts，并与成功推理分开。
- Whisper的t0/t1在此版本为毫秒；报告明确单位。YAMNet参考实现可能剩余不足一个hop的尾部，本探针增加最后一个窗口并明确实际处理终点。

## 1B输入与边界

四个适配路径已有实测证据，可以进入1B。通用运行使用DSH生产者来源；可见流过滤必须保持工具调用配对；真实路由在本次样例中不需要持久保存内部思考来完成续轮。

Host配置字段及默认值继续以[第一阶段方案第5节](unified-runtime-phase-1-plan.md)为冻结规格；首批特性为execution.task.v1、execution.wake-ingress.v1、context.execution.v1、source.execution-text.v1、observation.execution-text.v1、task.repository.v1、persona.growth-selection.v1。1A没有宣告这些新产品接口已经实现；1B据此提供严格Schema和生命周期。

服务器、正式人格、真实QQ新流程、B站账号、完整媒体管线和真实活动调度均未接入本步。现有未提交`docs/memory-phase-1.md`保持原样。
