import {ManagementRequestSchema,managementJson} from '@dafeiyu/contracts';
import type {Json} from '@dafeiyu/contracts';
import {SettingsError,readInstallationSettings} from './settings.js';
import type {ManagementSettings} from './management-settings.js';
import type {ManagementRuntime} from './management-runtime.js';

/** Ports are narrow on purpose: the protocol can be exercised without a live Cordis context. */
export interface ManagementDispatchPorts {
  readonly settings:Pick<ManagementSettings,'describe'|'apply'|'file'>;
  readonly runtime:Pick<ManagementRuntime,'control'|'call'|'status'>;
  readonly describe:()=>unknown;
}
export type ManagementDispatchResult={ok:true;value:Json}|{ok:false;code:string;fields:string[]};
const CREDENTIAL_FIELDS=['qq.botId','qq.ownerId','qq.tokenFile','qq.httpURL','qq.wsURL','bilibili.channel.accountUid','bilibili.channel.ownerUid'];
const codeOf=(error:unknown):string=>error instanceof Error&&/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:error instanceof SettingsError?'INSTALL_CONFIGURATION_REQUIRED':'MANAGEMENT_REQUEST_INVALID';

/**
 * The single management protocol dispatcher. Lifecycle control returns a receipt
 * with an operation id; instance status is never inferred from a sent command.
 */
export function createManagementDispatch(ports:ManagementDispatchPorts){
  return async function dispatch(payload:string):Promise<ManagementDispatchResult>{
    try{
      if(typeof payload!=='string'||Buffer.byteLength(payload)>262144)throw new Error('MANAGEMENT_INPUT_INVALID');
      const request=ManagementRequestSchema.parse(JSON.parse(payload));let value:unknown;
      if(request.kind==='describe'){
        let configuration:unknown;try{configuration=ports.settings.describe();}
        catch(error){configuration={error:error instanceof SettingsError?'INSTALL_CONFIGURATION_REQUIRED':'INSTALL_SETTINGS_UNAVAILABLE',fields:error instanceof SettingsError?error.fields:[]};}
        value={...(ports.describe() as Record<string,unknown>),configuration,runtime:ports.runtime.status()};
      }else if(request.kind==='save'){
        const values=Object.assign({},...request.changes.map(change=>change.values));
        if(Object.keys(values).some(key=>CREDENTIAL_FIELDS.includes(key))&&!['stopped','failed'].includes(ports.runtime.status().state))throw new Error('MANAGEMENT_STOP_REQUIRED');
        value=ports.settings.apply(request.revision,request.changes);
        if(request.changes.every(change=>change.module==='activity')&&Object.keys(values).every(key=>['activity.roundTokens','activity.roundDurationMs'].includes(key))&&ports.runtime.status().state==='running'){
          const config=readInstallationSettings(ports.settings.file).activity;
          try{await ports.runtime.call('activity','configure-budget',{roundTokens:config.roundTokens,roundDurationMs:config.roundDurationMs});value={...value as object,applies:'next-round'};}
          catch{value={...value as object,applies:'next-start',notice:'预算文件已保存；运行实例尚未确认接收，需要重启应用。'};}
        }
      }else if(request.kind==='runtime'){
        value=await ports.runtime.control(request.action,request.operationId===undefined?{}:{operationId:request.operationId});
      }else value=await ports.runtime.call(request.module,request.action,request.input);
      return {ok:true,value:managementJson(value)};
    }catch(error){
      return {ok:false,code:codeOf(error),fields:error instanceof SettingsError?[...error.fields]:[]};
    }
  };
}
