/** Versioned offline scope. Passing this catalog is not whole-release or real-model acceptance. */
export const catalog = [
  {id: 'patrol-new', requirements: ['R01', 'R07'], file: 'tests/group-patrol.test.ts', limitation: '脚本模型与隔离渠道；新任务修改原计划'},
  {id: 'patrol-amend', requirements: ['R01', 'R07'], file: 'tests/group-patrol-amend.test.ts', limitation: '脚本模型与隔离渠道；修订原任务'},
  {id: 'owner-report', requirements: ['R03', 'R08'], file: 'tests/owner-task-delivery.test.ts', limitation: '真实SDK和群存储；脚本核验只证明修稿控制流'},
  {id: 'dsh-result-read', requirements: ['R02'], file: 'tests/dsh-result-store.test.ts', limitation: '真实结果归档及分页；不代表宿主工具实际执行或完整诊断'},
  {id: 'video-reading', requirements: ['R04', 'R09'], file: 'tests/bili-reading-integration.test.ts', limitation: '八条合成视频资料及阅读记录；没有真实平台、字幕、画面或音轨覆盖'},
  {id: 'delivery-render-recovery', requirements: ['R06'], file: 'tests/native-delivery-interruption.test.ts', limitation: '有效材料内的生成阶段恢复；不覆盖过期授权续期和发送后重试'},
  {id: 'delivery-verifier-recovery', requirements: ['R06','R07'], file: 'tests/native-verification-interruption.test.ts', limitation: '主人retry接续同一候选；脚本核验不证明真实语义判断'},
] as const;
export const criteriaVersion = 'corrective-offline-2';
export const allRequirements = ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10'] as const;
export const offlineConfiguration = {mode: 'offline-sdk', model: {provider: 'local-test', model: 'scripted'},
  realModel: false, realPlatform: false, paidCalls: false, serverAccess: false, contextCapacity: 1000000} as const;
