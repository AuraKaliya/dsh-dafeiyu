import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinitions=[
  {
    "id": "system-execution",
    "title": "系统执行",
    "tab": "capabilities",
    "description": "使用已装配执行器在主机环境完成程序任务；管理员身份、来源授权与文件权限由真实运行环境决定。",
    "sections": [
      {
        "id": "environment",
        "title": "执行环境与当前授权",
        "description": "查看运行环境、命令入口、时限、主人绑定和共享计量状态。该独立安装方式没有宿主授权端口时明确显示未装配。",
        "fields": [],
        "panel": "status"
      },
      {
        "id": "authority",
        "title": "任务来源与执行范围",
        "description": "主人任务需要真实来源，长期自主任务使用独立 standing authority。界面不通过开关伪造管理员权限或扩大原任务范围。",
        "fields": []
      }
    ],
    "prompts": []
  },
  {
    "id": "dsh-tools",
    "title": "DSH 工具",
    "tab": "capabilities",
    "description": "通过已登录 DSH 的桥接访问文件、浏览器和插件装配能力；实际工具与权限由宿主提供。",
    "sections": [
      {
        "id": "connection",
        "title": "工具连接",
        "description": "装配后按实际工具目录呈现可用能力；工具失败保留真实回执。",
        "fields": [
          {
            "path": "dshTools",
            "label": "装配 DSH 工具",
            "kind": "boolean",
            "description": "保存后重启实例生效。"
          }
        ],
        "panel": "status"
      },
      {
        "id": "dsh-0",
        "title": "文件工具",
        "description": "使用宿主当前公开接口及既有任务授权；调用细节在任务与记录中查看。",
        "fields": []
      },
      {
        "id": "dsh-1",
        "title": "浏览器工具",
        "description": "使用宿主当前公开接口及既有任务授权；调用细节在任务与记录中查看。",
        "fields": []
      },
      {
        "id": "dsh-2",
        "title": "插件装配",
        "description": "使用宿主当前公开接口及既有任务授权；调用细节在任务与记录中查看。",
        "fields": []
      },
      {
        "id": "dsh-3",
        "title": "调用记录",
        "description": "使用宿主当前公开接口及既有任务授权；调用细节在任务与记录中查看。",
        "fields": []
      }
    ],
    "prompts": [
      {
        "id": "tools",
        "module": "dsh-tools",
        "title": "当前工具定义",
        "position": "tools",
        "dynamic": true,
        "condition": "按稳定名称顺序组装；工具装配变化时更新"
      }
    ]
  },
  {
    "id": "runtime",
    "title": "实例运行",
    "tab": "runtime",
    "description": "使用同一配置文件。常规配置下次启动生效，单独修改活动预算可对下一轮生效。",
    "sections": [
      {
        "id": "instance",
        "title": "实例",
        "description": "配置缺失或运行失败时，管理中心仍然可用。停止会先请求任务收尾。",
        "fields": [],
        "panel": "status"
      },
      {
        "id": "model",
        "title": "主模型",
        "description": "凭据由 DSH 凭据存储管理，此处仅设置引用路径。",
        "fields": [
          {
            "path": "model.auth",
            "label": "认证方式",
            "kind": "select",
            "description": "dsh-account 使用 DSH 官方账号；api-key 使用所引用凭据存储中的 API 密钥。",
            "options": [
              {
                "value": "dsh-account",
                "label": "DSH 官方账号"
              },
              {
                "value": "api-key",
                "label": "API 密钥凭据存储"
              }
            ]
          },
          {
            "path": "model.model",
            "label": "模型",
            "kind": "text",
            "description": "保存后重启生效。"
          },
          {
            "path": "model.reasoningEffort",
            "label": "推理强度",
            "kind": "text",
            "description": "使用当前提供方接受的值。"
          },
          {
            "path": "model.credentialStore",
            "label": "凭据存储文件",
            "kind": "text",
            "description": "不读取或显示凭据内容。"
          }
        ]
      },
      {
        "id": "timeouts",
        "title": "单次任务时限",
        "description": "故障保护时限独立于自主活动完成后的预算检查。",
        "fields": [
          {
            "path": "taskTimeoutMs",
            "label": "任务时限",
            "kind": "number",
            "unit": "分钟",
            "scale": 60000,
            "minimum": 0.016666666666666666,
            "maximum": 60,
            "description": "到期触发任务自身的取消机制。"
          }
        ]
      }
    ],
    "prompts": []
  }
] satisfies readonly ManagementModule[];
