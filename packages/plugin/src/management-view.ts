import type {ManagementControlResult,ManagementLifecycleState,ManagementRuntimePhase,ManagementRuntimeSnapshot} from '@dafeiyu/contracts';

/** User-facing lifecycle words. Internal phase names never reach the UI verbatim. */
export const LIFECYCLE_LABELS:Record<ManagementLifecycleState,string>={stopped:'已停止',starting:'启动中',waiting:'等待依赖',running:'运行中',stopping:'正在停止',failed:'启动或运行失败'};
export const PHASE_LABELS:Record<ManagementRuntimePhase,string>={idle:'空闲',configuration:'检查配置',qq:'等待 QQ',bridge:'准备桥接',process:'启动实例',ready:'实例就绪',stopping:'正在停止',stopped:'已停止'};
const CODE_LABELS:Record<string,string>={
  MANAGEMENT_STOPPING:'实例正在停止，请等待结束后再启动。',MANAGEMENT_START_UNCONFIRMED:'实例已创建但还没有确认就绪；正在核对实例状态，不会重复启动。',
  MANAGEMENT_STOP_UNCONFIRMED:'停止结果未能确认；请核对实例进程后再处理。',MANAGEMENT_INSTANCE_UNCONFIRMED:'实例仍存活但暂时无法确认就绪，请稍后刷新。',
  MANAGEMENT_RUNTIME_OFFLINE:'受管实例当前不在线。',MANAGEMENT_RUNTIME_DISPOSED:'管理中心已关闭。',MANAGEMENT_RESULT_UNKNOWN:'实例没有及时回复；结果待确认。',
  ONEBOT_NOT_RUNNING:'OneBot 没有运行；请先启动 SnowLuma/OneBot。',ONEBOT_LOGIN_REQUIRED:'OneBot 已启动，等待机器人账号登录。',ONEBOT_ACCOUNT_NOT_ATTACHED:'OneBot 已启动，但机器人账号尚未连接。',
  ONEBOT_TOKEN_UNAVAILABLE:'OneBot 令牌文件缺失或为空。',ONEBOT_SERVICE_START_FAILED:'OneBot 服务无法启动，请检查命令与路径。',ONEBOT_SERVICE_EXITED:'OneBot 服务启动后退出。',
  INSTALL_CONFIGURATION_REQUIRED:'配置不完整；请在下方模块中补全缺失字段。',INSTALL_NODE_UNAVAILABLE:'找不到可用的 Node.js 24 可执行文件。',INSTALL_PROCESS_EXITED:'实例进程已退出。',
  HOST_INITIALIZATION_REQUIRED:'新增模块尚未初始化；停止实例并备份后运行 init。',HOST_REQUIRED_STORAGE_MISSING:'原有数据库缺失，请恢复备份；不会用空库替换原数据。',
  HOST_CREDENTIAL_REFERENCE_MISSING:'模型凭据文件没有配置 DEEPSEEK_API_KEY，请在 DSH 中配置。',HOST_CREDENTIAL_STORE_UNSUPPORTED:'模型凭据文件格式不受支持，请使用 DSH 的版本 1 凭据文件。',
  BILI_SCHEMA_UNSUPPORTED:'B站数据库版本不受支持，需要显式迁移后再启动。',BILI_MIGRATION_REQUIRED:'B站数据库需要先完成迁移才能启动。',
};

/** One label for the badge: a startup phase is clearer than a bare "启动中". */
export function lifecycleLabel(snapshot:Pick<ManagementRuntimeSnapshot,'state'|'phase'>|null):string {
  if(!snapshot)return '正在读取';
  if((snapshot.state==='starting'||snapshot.state==='waiting')&&snapshot.phase!=='idle'&&snapshot.phase!=='stopped')return LIFECYCLE_LABELS[snapshot.state]+' · '+PHASE_LABELS[snapshot.phase];
  return LIFECYCLE_LABELS[snapshot.state];
}
export function phaseLabel(phase:ManagementRuntimePhase):string{return PHASE_LABELS[phase]??phase;}
export function errorHint(code:string|null|undefined):string|null{return code?CODE_LABELS[code]??'原因码 '+code:null;}

export interface RuntimeControls {start:boolean;stop:boolean;restart:boolean;reason:string|null}
/**
 * Button enablement follows the real lifecycle, not a local busy flag:
 * start is disabled while starting/waiting/running/stopping; stop and restart
 * follow operation ownership so one state cannot be changed by two entries.
 */
export function controlAvailability(snapshot:Pick<ManagementRuntimeSnapshot,'state'|'operationId'|'operation'>|null):RuntimeControls {
  if(!snapshot)return {start:false,stop:false,restart:false,reason:'正在读取运行状态'};
  const active=snapshot.operationId!==null?snapshot.operation:null;
  if(active&&active.disposition==='accepted'){
    if(active.action==='stop')return {start:false,stop:false,restart:false,reason:'停止进行中'};
    return {start:false,stop:true,restart:false,reason:'启动操作进行中'};
  }
  if(snapshot.state==='stopping')return {start:false,stop:false,restart:false,reason:'正在停止'};
  if(snapshot.state==='starting'||snapshot.state==='waiting')return {start:false,stop:true,restart:true,reason:'启动进行中'};
  if(snapshot.state==='running')return {start:false,stop:true,restart:true,reason:null};
  if(snapshot.state==='failed')return {start:true,stop:true,restart:true,reason:null};
  return {start:true,stop:false,restart:false,reason:null};
}
/** Polling cadence: fast while an operation or transition is live, slow when stable. */
export function pollInterval(snapshot:Pick<ManagementRuntimeSnapshot,'state'|'operationId'>|null):number|null {
  if(!snapshot)return 1_000;
  if(snapshot.operationId!==null)return 1_000;
  if(snapshot.state==='starting'||snapshot.state==='waiting'||snapshot.state==='stopping')return 1_000;
  return 5_000;
}
export interface ControlNotice {tone:'info'|'error';text:string}
/** A refused or failed operation must be visible even when the outer protocol answered ok:true. */
export function controlNotice(result:Pick<ManagementControlResult,'accepted'|'disposition'|'rejectCode'|'code'|'hostCode'|'operationId'>|null|undefined):ControlNotice|null {
  if(!result)return null;
  if(!result.accepted){const code=result.rejectCode??result.code;return {tone:'error',text:(errorHint(code)??'操作未受理')+'（'+String(code??'UNKNOWN')+'）'};}
  if(result.hostCode)return {tone:'error',text:'实例状态查询失败：'+String(result.hostCode)};
  if(result.disposition==='failed'){const code=result.code;return {tone:'error',text:'操作失败：'+(errorHint(code)??String(code??'未知原因'))+'（'+String(code??'UNKNOWN')+'）'};}
  if(result.disposition==='accepted')return {tone:'info',text:(errorHint(result.code)??'已受理，正在执行…')};
  return null;
}
export function controlRequest(action:'start'|'stop'|'restart',operationId?:string):{kind:'runtime';action:'start'|'stop'|'restart';operationId?:string}{
  return operationId?{kind:'runtime',action,operationId}:{kind:'runtime',action};
}
export interface InstanceCapabilityRow {id:string;title:string;state:string;detail:string|null}
const CAPABILITY_TITLES:Record<string,string>={qq:'QQ 连接',activity:'自主活动',bilibili:'B站能力'};
/** Instance lifecycle and B站 capability state are reported separately on purpose. */
export function capabilityRows(snapshot:Pick<ManagementRuntimeSnapshot,'capabilities'>|null,host:unknown):InstanceCapabilityRow[] {
  const rows:InstanceCapabilityRow[]=[];
  for(const capability of snapshot?.capabilities??[]){
    rows.push({id:capability.id,title:CAPABILITY_TITLES[capability.id]??capability.id,state:capability.state,detail:capability.message??capability.code??(capability.owned?'由本次实例启动':null)});
  }
  try{
    const value=host as {plugins?:Array<{id?:unknown;state?:unknown;code?:unknown}>;services?:{bilibili?:{diagnosticRequired?:unknown;backoffUntil?:unknown}|null}}|null;
    const plugin=value?.plugins?.find(item=>item.id==='bilibili');
    const bili=value?.services?.bilibili;
    if(plugin&&!rows.some(row=>row.id==='bilibili'))rows.push({id:'bilibili',title:'B站能力',state:typeof plugin.state==='string'?plugin.state:'unknown',detail:typeof plugin.code==='string'?plugin.code:bili?.diagnosticRequired?'诊断暂停':null});
  }catch{/* a partial host snapshot never breaks the lifecycle panel */}
  return rows;
}
export function retryText(retry:Pick<ManagementRuntimeSnapshot,'retry'>['retry']|undefined):string {
  if(!retry||retry.nextAt===null)return '自动重试未安排';
  return '第 '+retry.attempt+' 次重试 · '+retry.nextAt;
}
export function formatTime(value:string|null|undefined):string {
  if(!value)return '—';
  const date=new Date(value);
  if(Number.isNaN(date.getTime()))return value;
  return date.toLocaleTimeString('zh-CN',{hour12:false});
}
/** Monotonic response guard: an older poll response never overwrites a newer snapshot. */
export function createSequenceGuard(){let latest=0;return {issue():number{return ++latest;},accept(token:number):boolean{return token===latest;}};}
/** The client's shared response unwrapping; a failed inner result is never treated as success. */
export function unwrapResponse(result:{ok:boolean;code?:string;fields?:string[];value?:unknown}):unknown {
  if(!result.ok)throw new Error((result.code??'MANAGEMENT_REQUEST_FAILED')+(result.fields?.length?'：'+result.fields.join('、'):''));
  return result.value;
}
