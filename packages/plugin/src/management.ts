import {managementRemote} from './management-remote.js';
import {promptCatalog} from './prompt-catalog.js';
import type {Context} from '@deepseek-ai/cordis';
import {Remote,TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {ManagementRequestSchema,API_VERSION,RELEASE_VERSION,managementJson,QQ_SEQUENCE_INSTRUCTIONS} from '@dafeiyu/contracts';
import {ManagementSettings} from './management-settings.js';
import {ManagementRuntime} from './management-runtime.js';
import {managementModules} from './management-catalog.js';
import {readInstallationSettings,SettingsError} from './settings.js';

declare module '@deepseek-ai/cordis' {interface Context {dafeiyuManagement:ManagementController}}
export class ManagementController extends TypertRemoteService {
  readonly runtime:ManagementRuntime;private readonly settings:ManagementSettings;
  constructor(ctx:Context,config:{settingsFile:string;nodePath:string}){super(ctx,'dafeiyuManagement');this.settings=new ManagementSettings(config.settingsFile);this.runtime=new ManagementRuntime(ctx,config);ctx.effect(()=>ctx.typert.remotes.register(managementRemote));ctx.effect(()=>()=>this.runtime.dispose());}
  @Remote
  async request(payload:string):Promise<string>{
    if(this.ctx.invocation?.peer.principal.kind!=='owner')throw new Error('MANAGEMENT_OWNER_REQUIRED');
    try{if(typeof payload!=='string'||Buffer.byteLength(payload)>262144)throw new Error('MANAGEMENT_INPUT_INVALID');const request=ManagementRequestSchema.parse(JSON.parse(payload));let value:unknown;
      if(request.kind==='describe'){let configuration:unknown;try{configuration=this.settings.describe();}catch(error){configuration={error:error instanceof SettingsError?'INSTALL_CONFIGURATION_REQUIRED':'INSTALL_SETTINGS_UNAVAILABLE',fields:error instanceof SettingsError?error.fields:[]};}
        value={apiVersion:API_VERSION,version:RELEASE_VERSION,modules:managementModules,prompts:[...promptCatalog,{id:'qq-message-sequence',module:'qq',title:'QQ 消息序列与输出契约',position:'context',text:QQ_SEQUENCE_INSTRUCTIONS,condition:'QQ 渠道输出时；固定文字与当前输出 schema'}],configuration,runtime:this.runtime.status()};}
      else if(request.kind==='save'){const values=Object.assign({},...request.changes.map(change=>change.values));if(Object.keys(values).some(key=>['qq.botId','qq.ownerId','qq.tokenFile','qq.httpURL','qq.wsURL','bilibili.channel.accountUid','bilibili.channel.ownerUid'].includes(key))&&!['stopped','failed'].includes(this.runtime.status().state))throw new Error('MANAGEMENT_STOP_REQUIRED');value=this.settings.apply(request.revision,request.changes);if(request.changes.every(change=>change.module==='activity')&&Object.keys(values).every(key=>['activity.roundTokens','activity.roundDurationMs'].includes(key))&&this.runtime.status().state==='running'){const config=readInstallationSettings(this.settings.file).activity;try{await this.runtime.call('activity','configure-budget',{roundTokens:config.roundTokens,roundDurationMs:config.roundDurationMs});value={...value as object,applies:'next-round'};}catch{value={...value as object,applies:'next-start',notice:'预算文件已保存；运行实例尚未确认接收，需要重启应用。'};}}}
      else if(request.kind==='runtime')value=await this.runtime.control(request.action);
      else value=await this.runtime.call(request.module,request.action,request.input);
      return JSON.stringify({ok:true,value:managementJson(value)});
    }catch(error){return JSON.stringify({ok:false,code:error instanceof Error&&/^[A-Z_0-9]{1,100}$/.test(error.message)?error.message:error instanceof SettingsError?'INSTALL_CONFIGURATION_REQUIRED':'MANAGEMENT_REQUEST_INVALID',fields:error instanceof SettingsError?error.fields:[]});}
  }
}
