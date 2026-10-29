import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinition={
  "id": "qq",
  "title": "QQ",
  "tab": "capabilities",
  "description": "通过 SnowLuma 的 OneBot HTTP / WebSocket 接口收发 QQ 消息。连接检查只查询账号和群状态。",
  "sections": [
    {
      "id": "connection",
      "title": "连接组件",
      "description": "SnowLuma 提供 QQ 客户端；OneBot HTTP 执行调用，WebSocket 接收入站事件。凭据仅引用文件，不显示内容。",
      "fields": [
        {
          "path": "qq.botId",
          "label": "机器人 QQ",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.httpURL",
          "label": "OneBot HTTP 地址",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.wsURL",
          "label": "OneBot WebSocket 地址",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.tokenFile",
          "label": "连接凭据文件",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ],
      "panel": "status"
    },
    {
      "id": "owner",
      "title": "饲养员身份",
      "description": "唯一主人 QQ。更换绑定需要停止实例；现有来源的权限不会自动转移。",
      "fields": [
        {
          "path": "qq.ownerId",
          "label": "饲养员 QQ",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ]
    },
    {
      "id": "groups",
      "title": "消息收发 · 可观察群列表",
      "description": "观察不代表每条消息都回复；群助手由连接组件过滤。",
      "fields": [
        {
          "path": "qq.joinedGroups",
          "label": "观察全部已加入群",
          "kind": "boolean",
          "description": "启用后按实际群列表同步；关闭时仅观察下方列表。"
        },
        {
          "path": "qq.groupIds",
          "label": "指定群号",
          "kind": "lines",
          "description": "每行一项。"
        }
      ]
    },
    {
      "id": "names",
      "title": "消息收发 · 自然称呼",
      "description": "名称用于识别明确呼唤；普通提及、代码与引用不授予主人身份。",
      "fields": [
        {
          "path": "qq.naturalNames",
          "label": "回应称呼",
          "kind": "lines",
          "description": "每行一项。"
        }
      ]
    },
    {
      "id": "window",
      "title": "消息收发 · 限时观察窗口",
      "description": "同群背景限于已授权的本群；主动回看只产生观察材料，不触发回复。",
      "fields": [
        {
          "path": "context.background.enabled",
          "label": "注入同群背景",
          "kind": "boolean",
          "description": "仅包含当前授权会话的近期材料。"
        },
        {
          "path": "context.background.windowMs",
          "label": "同群背景时间",
          "kind": "number",
          "unit": "分钟",
          "scale": 60000,
          "minimum": 0.016666666666666666,
          "maximum": 1440,
          "description": "保存后重启生效。"
        },
        {
          "path": "context.background.limit",
          "label": "背景最多消息",
          "kind": "number",
          "unit": "条",
          "minimum": 1,
          "maximum": 32,
          "description": "时间与条数上限同时生效。"
        },
        {
          "path": "context.background.maxBytes",
          "label": "背景内容量",
          "kind": "number",
          "unit": "字节",
          "minimum": 256,
          "maximum": 16000,
          "description": "UTF-8 字节数，避免挤占当前请求。"
        },
        {
          "path": "qq.historyWindowMs",
          "label": "按需历史回看窗口",
          "kind": "number",
          "unit": "小时",
          "scale": 3600000,
          "minimum": 0.0002777777777777778,
          "maximum": 168,
          "description": "主动读取的窗口；最多 5 页，每页 20 条；不会自动回复旧消息。"
        }
      ]
    },
    {
      "id": "batch",
      "title": "消息收发 · 连续消息合并",
      "description": "同一发送者、同一会话的连续真实消息按顺序合并。",
      "fields": [
        {
          "path": "qq.messageBatch.enabled",
          "label": "启用合并",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.messageBatch.quietMs",
          "label": "静默等待",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "秒",
          "minimum": 0.01,
          "maximum": 10,
          "scale": 1000
        },
        {
          "path": "qq.messageBatch.maxWaitMs",
          "label": "最长等待",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "秒",
          "minimum": 0.01,
          "maximum": 30,
          "scale": 1000
        },
        {
          "path": "qq.messageBatch.maxMessages",
          "label": "最多消息",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "条",
          "minimum": 2,
          "maximum": 10,
          "scale": 1
        }
      ]
    },
    {
      "id": "delay",
      "title": "消息收发 · 自然聊天延迟",
      "description": "min(最大延迟, 最少延迟 + Unicode 字符数 × 每字增量)。一次逻辑回复只等待一次；媒体字节不计数。",
      "fields": [
        {
          "path": "qq.replyDelay.enabled",
          "label": "启用自然延迟",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.replyDelay.minimumMs",
          "label": "最少延迟",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "秒",
          "minimum": 0,
          "maximum": 60,
          "scale": 1000
        },
        {
          "path": "qq.replyDelay.perCharacterMs",
          "label": "每字增量",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "毫秒/字",
          "minimum": 0,
          "maximum": 1000,
          "scale": 1
        },
        {
          "path": "qq.replyDelay.maximumMs",
          "label": "最大延迟",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "秒",
          "minimum": 0,
          "maximum": 120,
          "scale": 1000
        },
        {
          "path": "qq.replyDelay.betweenMessagesMs",
          "label": "后续消息间隔",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "毫秒",
          "minimum": 0,
          "maximum": 60000,
          "scale": 1
        }
      ]
    },
    {
      "id": "stickers",
      "title": "消息收发 · 表情包管理",
      "description": "管理收集素材的名称、说明、标签与可用状态。原件与缓存分开保存；删除不抹去历史使用记录。",
      "fields": [
        {
          "path": "qq.stickers.enabled",
          "label": "启用表情素材",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.stickers.maxBytes",
          "label": "素材容量",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "MiB",
          "minimum": 1,
          "maximum": 1024,
          "scale": 1048576
        },
        {
          "path": "qq.stickers.maxEntries",
          "label": "最多素材",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "个",
          "minimum": 1,
          "maximum": 5000,
          "scale": 1
        }
      ],
      "panel": "stickers"
    },
    {
      "id": "media",
      "title": "消息收发 · 多媒体处理",
      "description": "接收支持的图片、音视频与文档；模型和解码器在多媒体能力中设置。",
      "fields": [
        {
          "path": "qq.media.sendEnabled",
          "label": "允许媒体发送",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.media.voiceDirectives",
          "label": "允许核验语音指令",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "qq.media.cacheRoots",
          "label": "允许的缓存目录",
          "kind": "lines",
          "description": "每行一项。"
        },
        {
          "path": "qq.media.httpsHosts",
          "label": "允许的 HTTPS 媒体主机",
          "kind": "lines",
          "description": "每行一项。"
        }
      ]
    }
  ],
  "prompts": []
} satisfies ManagementModule;
