import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinitions=[
  {
    "id": "tasks",
    "title": "任务与记录",
    "tab": "runtime",
    "description": "操作事实、结果、明确反思与用量分别展示；未知效果不自动重演。",
    "sections": [
      {
        "id": "tasks",
        "title": "任务详情",
        "description": "目标判断、执行阶段和实际交付使用同一进度视图。可恢复的生成、核验及确定未发部分可继续；未知回执不自动重发。",
        "fields": [],
        "panel": "tasks"
      },
      {
        "id": "context-capacity",
        "title": "上下文容量",
        "description": "按模型真实协议窗口与本次请求实际投影计量；maxTokens 是统一上限，不再有 24k/32k/48k 等阶段门槛。估算不会提前拒绝请求；以平台真实容量回执核验。",
        "fields": [
          {"path":"contextCapacity.maxTokens","label":"输入+输出共用窗口上限","kind":"number","description":"单次模型请求的输入与输出共用上限 token；实际再受模型真实窗口限制，不是单独的输入配额。","unit":"token","minimum":1000,"maximum":1000000}
        ]
      }
    ],
    "prompts": []
  }
] satisfies readonly ManagementModule[];
