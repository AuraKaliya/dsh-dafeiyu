# 本地候选与封存

0.28.13 提供本地候选验收入口。它只接受无真实模型、无真实平台的程序证据；成功表示本地候选具备当前可核对证据，`releaseAccepted` 固定为 `false`。真实模型语义、模型/配置冻结、实际费用及同进程不少于两小时且包含后段业务的观察仍须另行完成。

## 执行顺序

在原源码工作区完成修改并保持内容稳定，然后顺序执行：

1. `npm test`、`npm run test:smoke`，保存输出中的报告路径。所选测试报告不能替代这两个完整入口。
2. `npm run test:performance`，保存本次目录；`npm run test:acceptance`，保存本次独立离线目录。
3. `npm run prepare:calibration -- <新目录>`，生成 24 例语义输入、答案表和空观察模板；该步骤不调用模型。
4. 构建新的发布包，运行公开包检查，在包内独立安装自己的依赖，再执行 `check-fresh-install.mjs`。这个脚本只用回环服务和合成身份，核对初始化、冷启动、重复启动保护、停止与重启。
5. 用 `check-release-upgrade.mjs --from <旧发布包> --to <候选包> --workdir <新演练目录>` 进行隔离演练。两个包均须有各自已安装的依赖。旧程序初始化合成数据，当前程序走显式迁移；整个演练不启动模型或真实平台，不使用正式数据。
6. 准备以下索引文件，再运行 `npm run candidate:seal -- <索引文件>`。所有路径相对于源码工作区或使用绝对路径；输出目录必须是包外的新目录。

```json
{
  "release": ".runtime/public-releases/<候选目录>",
  "regression": ".runtime/test-reports/<本次全量运行ID>.json",
  "smoke": ".runtime/test-reports/<本次冒烟运行ID>.json",
  "business": ".runtime/acceptance/<本次目录>",
  "performance": ".runtime/performance/<本次目录>",
  "fresh": ".runtime/fresh-install/<本次目录>/acceptance.json",
  "upgrade": ".runtime/upgrade/<本次目录>/acceptance.json",
  "calibration": ".runtime/calibration/<本次目录>",
  "output": ".runtime/candidates/<新的封存目录>"
}
```

## 证据与复核

`candidate.json` 记录包内容、清单、源码、驱动、构建、依赖锁、实际模块位置和证据摘要。`evidence/` 保留本次完整报告与场景文件、性能采样、未执行的真实观察要求。运行 `npm run candidate:verify -- <candidate.json>` 可重新检查当前包、实际依赖、封存证据、匹配旧程序及三份数据快照；任一漂移都会失败。

包内根目录 `node_modules`、`package-lock.json` 不计入原程序摘要，另有独立摘要；`release.json` 自身也单独绑定。不得在封存包中构建源码、写入实例配置或绑定本机部署路径。需要安装到 DSH 时新建部署副本，并依安装指南单独核对它的配置、实际加载和就绪回执。

迁移演练保留停机快照、迁移后副本、匹配旧程序的回退副本。未知操作和未知发送仍为未知；批准但未交付的正文不重生成；计划版本和水位保持。回退会回到备份时点，升级后新增数据保存在单独副本，不自动合并到旧结构。合成存储演练证明保留和拒绝条件，不代表正式实例数据已迁移或已完成真实业务恢复。

本地候选成功后仍保留四项未完成：真实语义验证、实际模型与配置冻结、真实费用验证、同一进程两小时业务观察。不能填入预期答案作为语义观察，不能用历史运行、空闲计时、进程存在或登录通过代替本轮业务验收。付费测试、真实外发与部署沿用用户的单独授权范围。
