# 服务器基础组件依赖只读核对

2026-10-26。执行 `deployment/Inspect-FoundationDependencies.ps1`，通过管理中心既有 Windows PowerShell 远程助手，仅传 ScriptPath，不上传文件或触发应用加载。

根入口为已核对的 DSH CLI 发行包、Desktop 发行包、两个运行 profile、独立 update-guard，以及当前 QQ/Bili 包。静态解析公开 package 元数据、依赖和 bundle/module 标识，记录实际物理路径、hash、版本、公开 exports/main/bin。路径限定 C:\DSH，联接逐级检查，排除凭据、私密记忆、历史和会话目录；配置值、环境、脚本正文、聊天和原日志不返回。

上限为 700 个包、6000 条边、每文件 1 MiB。YAML 仅解析模块标识，config/块正文跳过；父 node_modules 的解析和发行路径 fallback 分别标注，声明不等于真实加载证明。发行版及 guard 依赖先标保留；来源、服务依赖或实际启用不明的包继续待核验，所有 removalEligible 为 false。

该脚本不修改服务器，不执行 DSH/npm、不导入应用代码，也不据包名前缀决定删除。实际清理仍须根据这份事实、运行状态和新功能接管结果形成明确候选清单。原账号、基础功能、SYSTEM 守护、真实新增记忆和服务器 Git 差异继续保护。

已通过本地语法解析；这是静态检查，不是服务器执行通过。执行结果及 hash 在完成后另记。
