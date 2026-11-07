# 2026-11-07 复盘前保存检查点

按本轮“先保存提交，再分析”的要求记录。检查时工作区无未提交源码，当前版本仍为 0.28.7；本次不改变运行代码、不重新部署、不推送。

- 已验收运行代码：`2a7a4223d9740116c8321952e8ccc70f15770c8f`。
- 保存前源码及文档 HEAD：`98407bb7432e14c8da65c71a69d7977d0459bfcf`。
- 分支：`codex/integrated-autonomy-20261103`。
- 既有结论见 [本地验收与用量说明](../results/local-acceptance-20261107.md)：既定场景和连续两小时运行检查通过，期间出现模型 HTTP 500，后续探索及成本限制仍需保留说明。

本机检查点：`.runtime/checkpoints/2026-11-07T10-14-04-146Z/`。该目录被 Git 忽略，内容包括：

1. 包含上述 HEAD 及可达历史的 `source.bundle`，已通过 `git bundle verify`；5,674,751 字节，SHA-256 为 `da130275d9e22f7885cffcf3d5bb5c361e0711efe9798b3b1f35043e7278a03a`。
2. 471 份验收驱动、过程日志及运行摘要的副本，共 16,382,028 字节。`manifest.json` 逐文件记录原相对路径、大小和 SHA-256。
3. 数据库、凭据、会话和媒体目录继续保留在原处；这不是整个实例数据的新全量备份。已有部署前备份仍由 `.runtime/integrated-20261106/deployment.json` 指向。

关键证据的 SHA-256：

| 文件（相对于 `.runtime/integrated-20261106/`） | SHA-256 |
| --- | --- |
| `final-acceptance-summary.json` | `0c9e2a0804e2156fda21171280dd485e8982ef4e68bffb5fd0d7cf8fbe7d6790` |
| `round-usage-20261107.json` | `2a9a9c5ba73b20077637a0bf49fd9f9be89e1283e25208cd9be2c8fd14d8727c` |
| `soak.mjs` | `1261ad59f1ae35f9d15fefa24929839c8dfe7db010d6b3525de73b9ccf41fde3` |
| `audit-soak.mjs` | `d5afc933ce8c20e72ef45e833bc80f0704669cb222f22b2dd44587e1eccbb578` |

原始对话、账号及凭据不加入此次 Git 提交。私有检查点用于本机追溯，不替代经过脱敏、进入版本管理的可复现验收程序。后续复盘单独提交，便于区分保存动作与分析结论。
