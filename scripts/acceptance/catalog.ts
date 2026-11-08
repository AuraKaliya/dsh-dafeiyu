/** Versioned offline scope. Passing this catalog is not whole-release or real-model acceptance. */
export const catalog = [
  {id: 'patrol-new', requirements: ['R01', 'R07'], file: 'tests/group-patrol.test.ts', limitation: '脚本模型与隔离渠道；新任务修改原计划'},
  {id: 'patrol-amend', requirements: ['R01', 'R07'], file: 'tests/group-patrol-amend.test.ts', limitation: '脚本模型与隔离渠道；修订原任务'},
  {id: 'owner-report', requirements: ['R03', 'R08'], file: 'tests/owner-task-delivery.test.ts', limitation: '真实SDK和群存储；脚本核验只证明修稿控制流'},
  {id: 'dsh-result-read', requirements: ['R02'], file: 'tests/dsh-result-store.test.ts', limitation: '真实结果归档及分页；不代表宿主工具实际执行或完整诊断'},
  {id: 'video-reading', requirements: ['R04', 'R09'], file: 'tests/bili-reading-integration.test.ts', limitation: '八条合成视频资料及阅读记录；没有真实平台、字幕、画面或音轨覆盖'},
  {id: 'delivery-render-recovery', requirements: ['R06'], file: 'tests/native-delivery-interruption.test.ts', limitation: '有效材料内的生成阶段恢复；不覆盖过期授权续期和发送后重试'},
  {id: 'delivery-verifier-recovery', requirements: ['R06','R07'], file: 'tests/native-verification-interruption.test.ts', limitation: '主人retry接续同一候选；脚本核验不证明真实语义判断'},
  {id: 'fault-notice', requirements: ['R06'], file: 'tests/native-fault-notice.test.ts', limitation: '程序故障通知、隔离渠道；没有付费模型'},
  {id: 'fault-notice-unknown', requirements: ['R06'], file: 'tests/native-fault-notice-unknown.test.ts', limitation: '未知通知回执保持未知，不代表实际用户收到'},
  {id: 'execution-fault-notice', requirements: ['R05'], file: 'tests/native-execution-fault-notice.test.ts', limitation: '执行失败的系统通知；不代表业务已恢复'},
  {id: 'task-send-text', requirements: ['R06'], file: 'tests/task-text-send-recovery.test.ts', limitation: '同一有效凭据内的文字分段接续'},
  {id: 'task-send-media', requirements: ['R06'], file: 'tests/task-media-send-recovery.test.ts', limitation: '合成文档附件；不代表真实媒体平台或TTS验收'},
  {id: 'task-send-not-sent', requirements: ['R06'], file: 'tests/task-unsent-recovery.test.ts', limitation: '渠道明确未发后的显式恢复'},
  {id: 'task-send-unknown', requirements: ['R06'], file: 'tests/task-send-unknown.test.ts', limitation: '未知回执保护；未执行真实平台回执查询'},
  {id: 'diagnostic-flow', requirements: ['R02'], file: 'tests/dsh-diagnostic-flow.test.ts', limitation: '真实SDK与本地源码读取、隔离DSH端口；非真实桌面或模型语义验收'},
  {id: 'context-folding', requirements: ['R02','R09'], file: 'tests/context-folding.test.ts', limitation: '固定十二份材料的SDK输入字节与重复正文；不代表供应商缓存命中或实际费用下降'},
  {id:'combined-chain',requirements:['R03','R06','R07','R08'],file:'tests/combined-chain.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-unknown',requirements:['R03','R06','R07','R08'],file:'tests/combined-unknown.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-cancel',requirements:['R03','R06','R07','R08'],file:'tests/combined-cancel.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revise',requirements:['R03','R06','R07','R08'],file:'tests/combined-revise.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revoke-query',requirements:['R03','R06','R07','R08'],file:'tests/combined-revoke-query.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revoke-render',requirements:['R03','R06','R07','R08'],file:'tests/combined-revoke-render.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revoke-verification',requirements:['R03','R06','R07','R08'],file:'tests/combined-revoke-verification.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revoke-send',requirements:['R03','R06','R07','R08'],file:'tests/combined-revoke-send.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-revoke-between',requirements:['R03','R06','R07','R08'],file:'tests/combined-revoke-between.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-media-revoke',requirements:['R03','R06','R07','R08'],file:'tests/combined-media-revoke.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
  {id:'combined-probe-business',requirements:['R03','R06','R07','R08'],file:'tests/combined-probe-business.test.ts',limitation:'SDK与隔离渠道的组合恢复；不代表真实模型语义或真实平台'},
] as const;
export const criteriaVersion = 'corrective-offline-5';
export const allRequirements = ['R01','R02','R03','R04','R05','R06','R07','R08','R09','R10'] as const;
export const offlineConfiguration = {mode: 'offline-sdk', model: {provider: 'local-test', model: 'scripted'},
  realModel: false, realPlatform: false, paidCalls: false, serverAccess: false, contextCapacity: 1000000} as const;
