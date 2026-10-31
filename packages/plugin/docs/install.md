# 从源码或发布包初始化一个新 DSH 实例

本指南是当前安装入口。全新安装直接使用当前版本；已有数据按“升级与回退”执行显式迁移。不要按历史验收记录逐个安装旧版本。

## 1. 环境与安装者需要的输入

已验证的环境：Windows、Node.js 24.13+（24.x）、DSH SDK 0.2.1-rc.2 / DSH Desktop 2.0.18。其它 DSH 版本先完成启动和管理协议检查。

准备：

- 一个安装包以外的实例目录，分别存放配置、数据和凭据。
- 模型名称，以及本机 DSH 的版本 1 凭据文件。API Key 模式需要其中已有 `DEEPSEEK_API_KEY`；账号模式配置 `model.auth: "dsh-account"` 并使用本机已登录的官方 DSH 账号存储。不要复制其它机器的账号登录态。
- 机器人 QQ、主人 QQ（两者不同）、本机 OneBot HTTP/WS 地址和令牌文件。QQ 登录由用户或已有 OneBot 服务提供。
- 若需要B站：预期 UID、本地凭据文件；画面理解还需要 FFmpeg、FFprobe 和视觉模型配置。B站与媒体是可选项，基础 QQ 初始化不需要它们。

初次建议按示例保持自主活动、DSH 工具及媒体关闭，先验证基础连接，再按需要启用。未取得必需输入时明确列出缺失字段，不能填写虚构账号或把示例当成已完成初始化。

OneBot 令牌至少 32 个字符，服务端与令牌文件必须使用同一个值；不能只改插件的文件而不改 OneBot 配置。

## 2. 分清源码工作区与发布包

源码根目录包含 `packages/`、`scripts/` 和工作区依赖；不能直接作为 DSH 插件安装。发布包根目录必须有：

```text
package.json          name 为 dsh-dafeiyu
release.json          版本、修订、内容摘要、存储版本
client.js             已构建的管理中心
cordis.patch.yml      DSH 组合补丁
bin/dafeiyu.mjs       配置检查、初始化、迁移及状态入口
runtime/              已编译模块
examples/             公开示例
docs/                 当前说明
```

若已经取得这种发布包，跳过源码构建。源码构建使用：

```powershell
npm ci
npm run build
node scripts/build-public-release.mjs .runtime/releases/current
node scripts/check-public-release.mjs .runtime/releases/current
```

输出目录必须是新的；已有目录使用新的名称，不覆盖在线包。公开检查不应出现私人配置、凭据、聊天记录或工作区依赖。

## 3. 创建实例配置

把发布包 `examples/dafeiyu.config.json`（源码中的对应文件为 `packages/plugin/examples/dafeiyu.config.json`）复制到实例的配置目录，填写真实输入。

至少填写：`model.model`、`model.credentialStore`、`qq.botId`、`qq.ownerId`、`qq.tokenFile`。核对 OneBot 地址。`dataDir` 建议设为配置目录以外的相邻数据目录，例如 `../data`。

所有相对路径都相对于配置文件，不是启动命令所在目录。配置必须为 UTF-8 无 BOM；Windows PowerShell 5.1 不要使用会写入 BOM 的 `Set-Content -Encoding UTF8`。可用 Node 的 `JSON.stringify` 与 `writeFileSync(..., 'utf8')` 结构化写入。

凭据与令牌保持为本机文件，不粘贴到聊天或提交进 Git。模型凭据是 DSH 的凭据文件，不能把裸 API Key 文本文件误填为 `model.credentialStore`。可通过 DSH 的凭据设置生成该文件。

## 4. 准备独立部署目录及依赖

从源码部署时使用工作区脚本，示例路径需要替换为当前机器的实际路径：

```powershell
$releaseDir = 'D:/DafeiyuBuild/current'
$deployDir = 'D:/Dafeiyu/packages/current'
$settingsFile = 'D:/Dafeiyu/configuration/dafeiyu.config.json'
$nodeExe = 'D:/Node/node.exe'
node scripts/prepare-local-deploy.mjs --release $releaseDir --target $deployDir --settings $settingsFile --node $nodeExe
npm install --prefix $deployDir --omit=dev --ignore-scripts --no-audit --no-fund
```

准备脚本复制发布包，并在这份本机部署副本中绑定 `settingsFile`、`nodePath` 和自动启动。它不再链接开发工作区的依赖。必须在部署目录安装依赖，独立子进程才可以解析自己需要的 SDK。

只有发布包时，同样复制到新的部署目录，在其根目录安装依赖，并将其 `cordis.patch.yml` 改为以下组合补丁（只修改本机部署副本）：

```yaml
- insert:
    - id: dsh-dafeiyu
      name: dsh-dafeiyu
      config:
        settingsFile: 'D:/Dafeiyu/configuration/dafeiyu.config.json'
        nodePath: 'D:/Node/node.exe'
        startOnLoad: true
```

上述是包的组合补丁结构；不要把裸的 `- id/name/config` 条目直接追加到不匹配的 profile 补丁文件。每个实例使用自己的部署副本和数据目录。

## 5. 检查并初始化

在 DSH 加载插件前，使用部署包的 CLI：

```powershell
& $nodeExe "$deployDir/bin/dafeiyu.mjs" check --settings $settingsFile
& $nodeExe "$deployDir/bin/dafeiyu.mjs" init --settings $settingsFile
```

成功标准：`check` 返回 `INSTALL_CONFIGURATION_VALID`，`init` 返回 `INSTALL_INITIALIZED`。首次初始化建立实例身份、人格底色和当前版本的存储。重复执行 `init` 必须沿用身份及原数据。

已有基础实例新增 B站、媒体或自主活动时：停止实例并备份 → 保存完整的新模块配置 → 再执行 `init` → 启动。该命令只创建新启用模块的缺失存储，保留原身份及数据库；普通启动不隐式补库。曾经必需的数据库丢失时会报告 `HOST_REQUIRED_STORAGE_MISSING`，不能用空库顶替。

`check` 不验证模型或平台连通性；`init` 也不等于已经登录 QQ 或可以调用真实模型。若提示缺失字段、凭据文件或媒体资源，先处理该项。已有库需要升级时停止实例并运行 `migrate`，不要清空目录后假装新装。

## 6. 在全新 DSH 中安装并启动

1. 确认本机 OneBot 已运行、机器人已登录。若配置了 `qq.service`，管理器也可以启动并管理该服务；外部服务与插件自建服务的归属不同。
2. 使用 DSH 插件管理的本地目录安装，选择第 4 步的发布部署目录。安装入口应识别包名 `dsh-dafeiyu`，不能选择源码根目录。
3. 让 DSH 安装器处理 profile 依赖和组合补丁。需要重新加载/重启时执行并等待完成；从 DSH 外部部署的 Agent 可自行完成用户已经授权的重启。
4. 打开设置中的“大肥鱼管理中心”。自动启动和手动启动共用一个控制器；已启动时再次请求启动应返回当前实例，不复制进程。
5. 查询真实运行状态：

```powershell
& $nodeExe "$deployDir/bin/dafeiyu.mjs" status --settings $settingsFile
```

应有 `online: true`，快照接受任务，QQ 服务为 `online`。`degraded` 时阅读具体组件原因：单个B站接口受限与主实例启动失败是两件事。

本地链接部署还要核对 profile 中的包声明、pnpm 锁、`node_modules/dsh-dafeiyu` 的实际解析目标。已有 profile 链接的修复入口为源码 `scripts/repair-dsh-profile.mjs`；先检查，再按需要执行明确的 `--repair --align-plugin`。新 profile 没有该依赖时使用 DSH 安装器安装，不用修复脚本伪造首次安装。

`dshTools:true` 的实例必须由 DSH 桌面管理器启动，独立 CLI 会报告 `INSTALL_DSH_DESKTOP_REQUIRED`，不能靠伪造桥接环境变量绕过。`check`、`init`、`migrate` 和 `status` 仍可从外部运行。

## 7. 启用B站 Cookie 与媒体

参见 [B站登录与读取](bilibili.md) 和 [配置字段](configuration.md)。HTTP、浏览器及私信的预期 UID 必须一致。浏览器已经登录不会自动创建 HTTP 凭据文件；需要使用用户明确指定的本地凭据，或由安装者通过该浏览器支持的本地会话导出接口生成文件。

验证登录只证明账号有效，还要测试视频、搜索、评论及字幕样本。若仍受风控限制，保留诊断和进度，不能反复清空暂停或循环切换通道。

## 8. 升级与回退

当前 B站库为 v6，运行库为 v2。新建库直接创建当前版本。已存在的受支持旧库使用：

```powershell
& $nodeExe "$deployDir/bin/dafeiyu.mjs" migrate --settings $settingsFile
```

顺序为：停止并确认占用释放 → 备份配置、数据、profile 和当前包 → 校验新包 → 显式迁移 → 对齐实际链接 → 初始化生成配置 → 重启并核对。

迁移器核对身份、完整性和已知结构，并生成一致性 SQLite 备份。未知版本或身份不符时停止，不改库版本号，不进行隐式迁移。回退涉及库版本变化时须同时恢复匹配的旧包、profile 和迁移前数据库；先保留升级后的副本以免丢失新增记录。

## 9. 安装验收记录

至少记录：包版本/修订/摘要、依赖解析是否来自部署目录、配置检查、首次初始化和重复初始化的身份一致性、冷启动、重复启动 PID 不变、停止与重启、实际在线状态。

开发者可运行 `node scripts/check-fresh-install.mjs --package <独立安装依赖的发布目录> --workdir <全新验收目录>`。它用真实发布入口、CLI、SDK 和存储验证基础初始化、重复启动及后续模块初始化；平台由本机回环测试服务替代，媒体路径仅为初始化夹具，不代表媒体处理验收。

源码回归、独立发布包初始化、真实模型调用、QQ/B站真实交互分别记结果。缺少账号或真实平台仍受限时，不把离线测试通过写成全部平台验收完成。
