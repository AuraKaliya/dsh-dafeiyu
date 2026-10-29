import type {ManagementModule} from '@dafeiyu/contracts';
export const managementDefinition={
  "id": "media",
  "title": "多媒体",
  "tab": "capabilities",
  "description": "为能力模块提供解码、视觉观察、语音识别、声音事件、文档读取和语音合成。",
  "sections": [
    {
      "id": "files",
      "title": "文件处理限制",
      "description": "单文件与总缓存限制分别生效。",
      "fields": [
        {
          "path": "media.maxAssetBytes",
          "label": "单文件上限",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "MiB",
          "minimum": 0.001,
          "maximum": 256,
          "scale": 1048576
        },
        {
          "path": "media.timeoutMs",
          "label": "单次处理时限",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "秒",
          "minimum": 1,
          "maximum": 300,
          "scale": 1000
        }
      ]
    },
    {
      "id": "cache",
      "title": "缓存管理",
      "description": "素材原件不随媒体缓存清理；运行中不直接删除在用文件。",
      "fields": [
        {
          "path": "media.maxBytes",
          "label": "缓存容量",
          "kind": "number",
          "description": "保存后重启实例生效。",
          "unit": "MiB",
          "minimum": 1,
          "maximum": 16384,
          "scale": 1048576
        }
      ],
      "panel": "status"
    },
    {
      "id": "vision",
      "title": "图片理解",
      "description": "独立视觉请求；只解释实际附带图像。",
      "fields": [
        {
          "path": "media.vision.provider",
          "label": "视觉提供方",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "media.vision.model",
          "label": "视觉模型",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ],
      "optionalPath": "media.vision"
    },
    {
      "id": "video",
      "title": "视频画面读取",
      "description": "使用 FFmpeg / FFprobe 抽帧，复用图片理解；帧采样不会被标记为完整观看。",
      "fields": [
        {
          "path": "media.ffmpeg",
          "label": "FFmpeg 路径",
          "kind": "text",
          "description": "保存后重启实例生效。"
        },
        {
          "path": "media.ffprobe",
          "label": "FFprobe 路径",
          "kind": "text",
          "description": "保存后重启实例生效。"
        }
      ]
    },
    {
      "id": "asr",
      "title": "语音识别",
      "description": "Whisper 本地识别，配置模型路径及 SHA256。",
      "fields": [
        {
          "path": "media.audio.whisper.node",
          "label": "Node.js 可执行文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.audio.whisper.moduleDirectory",
          "label": "Whisper 组件目录",
          "kind": "text",
          "description": "使用 whisper.cpp 绑定 1.1.3 的已安装目录。"
        },
        {
          "path": "media.audio.whisper.model.path",
          "label": "语音模型文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.audio.whisper.model.sha256",
          "label": "语音模型 SHA256",
          "kind": "text",
          "description": "用可信来源公布的 SHA256 核验文件；不是文件名。"
        },
        {
          "path": "media.audio.whisper.language",
          "label": "识别语言",
          "kind": "text",
          "description": "auto 自动识别，或两至三位语言代码；默认 auto。"
        },
        {
          "path": "media.audio.whisper.memoryBytes",
          "label": "工作进程内存上限",
          "kind": "number",
          "unit": "MiB",
          "scale": 1048576,
          "minimum": 128,
          "maximum": 2048,
          "description": "默认 512 MiB；范围 128–2048 MiB。"
        }
      ],
      "optionalPath": "media.audio.whisper"
    },
    {
      "id": "sound",
      "title": "声音事件识别",
      "description": "ONNX 声音分类独立于语音文字识别。",
      "fields": [
        {
          "path": "media.audio.events.python",
          "label": "Python 可执行文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.audio.events.model.path",
          "label": "声音事件模型文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.audio.events.model.sha256",
          "label": "声音事件模型 SHA256",
          "kind": "text",
          "description": "用可信来源公布的 SHA256 核验文件；不是文件名。"
        },
        {
          "path": "media.audio.events.labels.path",
          "label": "标签文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.audio.events.labels.sha256",
          "label": "标签 SHA256",
          "kind": "text",
          "description": "用可信来源公布的 SHA256 核验文件；不是文件名。"
        },
        {
          "path": "media.audio.events.onnxruntimeVersion",
          "label": "ONNX Runtime 版本",
          "kind": "text",
          "description": "填写已安装的实际版本，启动时核验。"
        },
        {
          "path": "media.audio.events.numpyVersion",
          "label": "NumPy 版本",
          "kind": "text",
          "description": "填写已安装的实际版本，启动时核验。"
        },
        {
          "path": "media.audio.events.memoryBytes",
          "label": "工作进程内存上限",
          "kind": "number",
          "unit": "MiB",
          "scale": 1048576,
          "minimum": 128,
          "maximum": 2048,
          "description": "保存后重启生效。"
        }
      ],
      "optionalPath": "media.audio.events"
    },
    {
      "id": "documents",
      "title": "文档读取",
      "description": "本地文档提取；内容作为非可信观察。",
      "fields": [
        {
          "path": "media.documents.python",
          "label": "Python 可执行文件",
          "kind": "text",
          "description": "使用已安装 pypdf 6.10.0 的 Python 环境。"
        }
      ],
      "optionalPath": "media.documents"
    },
    {
      "id": "tts",
      "title": "语音回复",
      "description": "语音合成生成媒体，由原渠道权限决定是否发送。",
      "fields": [
        {
          "path": "media.tts.powershell",
          "label": "PowerShell 可执行文件",
          "kind": "text",
          "description": "填写已有组件或文件的位置；保存后重启生效。"
        },
        {
          "path": "media.tts.voice",
          "label": "系统语音名称",
          "kind": "text",
          "description": "使用该系统已经安装的语音；不会自动下载语音包。"
        }
      ],
      "optionalPath": "media.tts"
    }
  ],
  "prompts": []
} satisfies ManagementModule;
