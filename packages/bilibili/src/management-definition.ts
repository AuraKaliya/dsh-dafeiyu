import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinition={
  "id": "bilibili",
  "title": "B站",
  "tab": "capabilities",
  "description": "管理已有的公开内容读取与唯一主人私信渠道。读取字幕不代表已经理解画面或音轨。",
  "sections": [
    {
      "id": "content",
      "title": "内容账号",
      "description": "登录凭据由本地文件提供；只引用凭据文件路径，管理中心和聊天都不接收 Cookie 原文。文件格式为 JSON：uid、SESSDATA，可选 buvid3、bili_jct。",
      "fields": [
        {
          "path": "bilibili.capabilities",
          "label": "装配公开读取能力",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "bilibili.session.expectedUid",
          "label": "内容账号 UID",
          "kind": "text",
          "description": "保存前需先停止实例；必须与服务端返回的登录 UID 一致。"
        },
        {
          "path": "bilibili.session.file",
          "label": "登录凭据文件",
          "kind": "text",
          "description": "保存前需先停止实例；路径位于实例外部凭据目录，按整份文件读取校验。"
        }
      ]
    },
    {
      "id": "account",
      "title": "登录验证与读取可用性",
      "description": "验证在后台执行，结果分批返回：登录是否有效、UID 是否匹配、各接口是否可读分别记录，互不代替。",
      "fields": [],
      "panel": "bilibili-status"
    },
    {
      "id": "browser",
      "title": "浏览器连接",
      "description": "使用 DSH 桌面桥读取已登录浏览器；须同时装配 DSH 工具。预期浏览器 UID 必须与内容 HTTP、私信账号一致，错配在启用前报告。",
      "fields": [
        {
          "path": "bilibili.browser.expectedUid",
          "label": "预期浏览器 UID",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ]
    },
    {
      "id": "read",
      "title": "公开内容与媒体读取",
      "description": "默认使用已验证且当前可用的登录态 HTTP；匿名、已登录与媒体/字幕资源的暂停分别记录。结果记录实际覆盖范围；不包含发表评论或发布弹幕。",
      "fields": []
    },
    {
      "id": "cadence",
      "title": "请求节奏",
      "description": "平台退避持续生效，不能通过刷新页面绕过。",
      "fields": [
        {
          "path": "bilibili.requestPolicy.minIntervalMs",
          "label": "请求最少间隔",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "毫秒",
          "minimum": 100,
          "maximum": 60000,
          "scale": 1
        },
        {
          "path": "bilibili.requestPolicy.retry.rateDelaysMs",
          "label": "限流后的等待序列",
          "kind": "numbers",
          "unit": "秒",
          "scale": 1000,
          "description": "每行一个等待时长，按连续失败次数使用；默认 10、30、60 秒，最多 8 项。平台提供的等待要求仍优先。"
        },
        {
          "path": "bilibili.requestPolicy.retry.riskDelayMs",
          "label": "风控后的等待",
          "kind": "number",
          "unit": "秒",
          "scale": 1000,
          "minimum": 1,
          "maximum": 3600,
          "description": "默认 30 秒；诊断暂停独立生效，不会自动反复冲击接口。"
        }
      ]
    },
    {
      "id": "owner",
      "title": "私信主人绑定",
      "description": "私信仅接收和回复固定主人；群聊不能读取私信。",
      "fields": [
        {
          "path": "bilibili.channel.accountUid",
          "label": "私信账号 UID",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "bilibili.channel.ownerUid",
          "label": "唯一主人 UID",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "bilibili.channel.sessionFile",
          "label": "私信凭据文件",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ]
    },
    {
      "id": "tasks",
      "title": "私信任务",
      "description": "主人请求进入现有任务系统，执行结果经人格表达整理后返回私信。",
      "fields": []
    },
    {
      "id": "timeouts",
      "title": "请求时限与响应大小",
      "description": "限时和大小针对单个请求；平台退避独立生效。",
      "fields": [
        {
          "path": "bilibili.requestPolicy.timeoutMs",
          "label": "请求时限",
          "kind": "number",
          "unit": "秒",
          "scale": 1000,
          "minimum": 1,
          "maximum": 60,
          "description": "超时保留失败回执。"
        },
        {
          "path": "bilibili.requestPolicy.maxResponseBytes",
          "label": "接口响应上限",
          "kind": "number",
          "unit": "MiB",
          "scale": 1048576,
          "minimum": 0.001,
          "maximum": 16,
          "description": "限制接口文本响应。"
        },
        {
          "path": "bilibili.requestPolicy.maxMediaReadBytes",
          "label": "媒体读取上限",
          "kind": "number",
          "unit": "MiB",
          "scale": 1048576,
          "minimum": 0.001,
          "maximum": 256,
          "description": "媒体与文字响应分别限制。"
        }
      ]
    }
  ],
  "prompts": [
    {
      "id": "bili-observation",
      "module": "bilibili",
      "title": "B站观察结果",
      "position": "context",
      "dynamic": true,
      "condition": "实际调用已有读取能力时"
    }
  ]
} satisfies ManagementModule;
