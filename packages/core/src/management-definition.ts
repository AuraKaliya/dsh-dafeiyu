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
      }
    ],
    "prompts": []
  }
] satisfies readonly ManagementModule[];
