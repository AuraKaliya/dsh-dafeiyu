import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinition={
  "id": "memory",
  "title": "人格与记忆",
  "tab": "personality",
  "description": "初始底色只导入一次。当前自我认识由大肥鱼基于明确反思更新；主人管理依据，不直接覆盖人格。",
  "sections": [
    {
      "id": "personality",
      "title": "当前人格与记忆依据",
      "description": "查看底色、自我认识、真实经历与明确反思；删除或恢复依据会影响相应来源的有效性。",
      "fields": [],
      "panel": "memory"
    }
  ],
  "prompts": [
    {
      "id": "foundation",
      "module": "memory",
      "title": "初始化身份底色",
      "position": "system",
      "condition": "实例首次导入后稳定保存在记忆中"
    },
    {
      "id": "self",
      "module": "memory",
      "title": "当前自我认识与记忆召回",
      "position": "context",
      "dynamic": true,
      "condition": "有当前可用的记忆和依据时"
    }
  ]
} satisfies ManagementModule;
