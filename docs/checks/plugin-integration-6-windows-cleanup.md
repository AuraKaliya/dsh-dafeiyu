# Windows处理器取消与清理复核

2026-10-27。冻结候选d071055的首批560项中559通过、1项因Windows取消后临时目录EPERM失败（`92cdc197-863f-4138-9604-19c7f047b915`）。该批不能记为全通过。

最初仅等待终止进程并增加删除重试仍会失败（`216938b6-a23b-4bc5-8604-f9ae58d7f8de`）。现场为空目录、包含当前用户的Delete拒绝规则；与.NET CodeDOM临时目录保护一致，其正常Dispose会移除该规则，强制终止来不及完成。依据：[Microsoft TempFileCollection参考源码](https://raw.githubusercontent.com/microsoft/referencesource/main/System/compmod/system/codedom/compiler/TempFiles.cs)。

最终处理：等待自身终止任务完成；遇EPERM/EACCES时，只在已经停止的本次process临时目录中，对符合CodeDOM名称、所有者和精确拒绝规则的目录移除那一条Delete拒绝ACE，再删除。拒绝根目录、外部路径和重解析点，不增加其它主体权限，不修改系统执行策略。辅助脚本使用与现有处理器一致的单进程ExecutionPolicy参数。常规清理及最终重试均有限。

最终相关6项通过（`0fd2c3f6-8ed0-41d8-81d3-10df606624e6`）：包含四个时点的真实Windows取消、内存限制、输出溢出、清理范围拒绝与有效范围控制，以及安装包检查。两处本轮已关闭失败现场的编译器残留权限已按同一受限方法恢复，仍由原保留策略回收。

同时让公开Git忽略默认数据目录、本地配置、令牌及会话日志，并将其加入发布扫描拒绝项。真实Git忽略规则、公开包安装和隐私拒绝共2项通过（`32dff8e3-496d-48f5-a6b5-39635bfb1829`）。全部本机执行，模型/平台模拟，未连接服务器。最终全量覆盖以修复后新的三批报告为准。
