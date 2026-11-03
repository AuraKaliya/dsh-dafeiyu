import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinition={
  "id": "activity",
  "title": "自主活动",
  "tab": "runtime",
  "description": "程序判断空闲与权限，大肥鱼决定执行计划、整理记忆、探索或休息。",
  "sections": [
    {
      "id": "allow",
      "title": "允许自主活动",
      "description": "前台排队、运行、待发送消息都会阻止新活动；前台抢占时请求暂停。",
      "fields": [
        {
          "path": "activity.enabled",
          "label": "允许自主活动",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "activity.idleAfterMs",
          "label": "持续空闲多久后允许活动",
          "kind": "number",
          "unit": "秒",
          "scale": 1000,
          "minimum": 0,
          "maximum": 86400,
          "description": "从最后一次前台排队、运行、待发送回复或待合并输入结束后计算。"
        },
        {
          "path": "activity.minIntervalMs",
          "label": "轮次最少间隔",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "分钟",
          "minimum": 1,
          "maximum": 1440,
          "scale": 60000
        },
        {
          "path": "activity.timeZone",
          "label": "时区",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "activity.quiet",
          "label": "安静时段",
          "kind": "time-windows",
          "description": "采用上方时区，可以跨越午夜；最多 8 个时段。"
        },
        {
          "path": "activity.maintenance",
          "label": "允许整理记忆",
          "kind": "boolean",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "activity.plans",
          "label": "允许执行已有计划",
          "kind": "boolean",
          "description": "只执行来源和权限仍有效的计划。"
        },
        {
          "path": "activity.exploration",
          "label": "允许空闲时自主选择活动",
          "kind": "boolean",
          "description": "使用 DSH 正常任务循环；大肥鱼可以选择探索或休息。"
        },
        {
          "path": "activity.allowedCapabilities",
          "label": "探索允许使用的能力",
          "kind": "choices",
          "description": "仅装配且授权的能力可用于探索；选择不会创建消息来源或系统权限。",
          "options": [
            {
              "value": "bilibili",
              "label": "B站公开内容"
            },
            {
              "value": "media",
              "label": "多媒体理解"
            },
            {
              "value": "dsh-tools",
              "label": "DSH 工具"
            }
          ]
        }
      ]
    },
    {
      "id": "scheduling",
      "title": "探索、休息与分享",
      "description": "上下文容量与调度分开。旧轮次预算仅保留历史记录，不作为任务总用量限制。",
      "fields": [
  {
    "path": "activity.explorationIntervalMs",
    "label": "自由探索候选检查间隔",
    "kind": "number",
    "unit": "分钟",
    "scale": 60000,
    "minimum": 1,
    "maximum": 10080,
    "description": "没有新材料不启动完整阅读；不限制已承接任务。"
  },
  {
    "path": "activity.restMs",
    "label": "默认休息时间",
    "description": "保存后重启实例生效；不限制已经承接任务的上下文容量。",
    "kind": "number",
    "unit": "分钟",
    "scale": 60000,
    "minimum": 1,
    "maximum": 10080
  },
  {
    "path": "activity.ownerSharing.enabled",
    "label": "向主人分享新发现",
    "description": "保存后重启实例生效；不限制已经承接任务的上下文容量。",
    "kind": "boolean"
  },
  {
    "path": "activity.ownerSharing.cooldownMs",
    "label": "普通分享最少间隔",
    "description": "保存后重启实例生效；不限制已经承接任务的上下文容量。",
    "kind": "number",
    "unit": "分钟",
    "scale": 60000,
    "minimum": 1,
    "maximum": 1440
  }
],
      "panel": "activity"
    }
  ],
  "prompts": [
    {
      "id": "activity-context",
      "module": "activity",
      "title": "本轮活动与预算结算",
      "position": "context",
      "dynamic": true,
      "condition": "自主活动唤醒时"
    }
  ]
} satisfies ManagementModule;
