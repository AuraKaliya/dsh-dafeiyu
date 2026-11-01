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
        "description": "暂停与取消通过运行引擎提交，不能直接改写数据库状态。",
        "fields": [],
        "panel": "tasks"
      },
      {
        "id": "context-capacity",
        "title": "上下文容量",
        "description": "按模型真实协议窗口与本次请求实际投影计量；maxTokens 是统一上限，不再有 24k/32k/48k 等阶段门槛。requestMaxBytes 只是本地序列化护栏，不是模型上下文配额。",
        "fields": [
          {"path":"contextBudget.maxTokens","label":"输入+输出共用窗口上限","kind":"number","description":"单次模型请求的输入与输出共用上限 token；实际再受模型真实窗口限制，不是单独的输入配额。","unit":"token","minimum":1000,"maximum":1000000},
          {"path":"contextBudget.outputReserveBytes","label":"输出预留（本地投影）","kind":"number","description":"旧的本地输出预留字节，仅用于受控上下文装配；实际模型输出额度以协议返回为准。","unit":"byte","minimum":0,"maximum":256000},
          {"path":"contextBudget.requestMaxBytes","label":"序列化护栏","kind":"number","description":"本地请求序列化上限，防止异常大对象；不作为模型上下文准入条件。","unit":"byte","minimum":1000,"maximum":67108864}
        ]
      }
    ],
    "prompts": []
  }
] satisfies readonly ManagementModule[];
