# 更新守护公开文件原位核对

2026-10-27，北京时间。仅执行固定 13 文件的有界 SHA256/大小检查，没有导入应用、读取私密数据或数据库、写入远端文件、停止服务或修改守护。

有效采样时间 `2026-10-27T00:58:17.9810817+08:00`，约 553 ms。报告 `docs/results/server-update-guard-metadata-20261027.json` 的 SHA256 为 `ce95f0d80cca35283297c22ade4939deb0cda9ce495566d4f5f1e7786a790bf9`。

现网固定目录 `C:\DSH\DaFeiYu\程序\update-guard` 下 package、cli、client、control、patch、daemon、engine、files、platform、store、tools、validate、guard.test 共 13 文件均存在，逐项与本地管理中心 `自主更新保护开发/程序/update-guard` 参考原字节一致。因此后续可静态审阅这些本地参考的完整算法；此结果不授权将旧整体镜像覆盖服务器。

首轮同日 00:57:51 探针未带 UTF-8 BOM，Windows PowerShell 5 把脚本中的中文路径解码错误，返回的 13 项 missing 属于错误目录。该无效报告保留在 `.runtime/deployment/server-update-guard-metadata-20261027.json`，不得用于判定现网文件丢失。修正编码后才得到上述有效结果，探针源码保留 BOM 以适配规定的 Windows PowerShell 入口。

本检查没有确认 active update、当前 stable candidate、线上健康、夜间版本状态或 Git 差异；更不证明更新守护已适配新 Host。维护/切换前仍须读取实际运行元数据，排空旧消费者，保留新真实记忆和原守护历史。
