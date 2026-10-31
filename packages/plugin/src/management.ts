import {managementRemote} from './management-remote.js';
import {promptCatalog} from './prompt-catalog.js';
import type {Context} from '@deepseek-ai/cordis';
import {Remote,TypertRemoteService} from '@deepseek-ai/dsh-typert-protocol';
import {API_VERSION,RELEASE_VERSION,QQ_SEQUENCE_INSTRUCTIONS} from '@dafeiyu/contracts';
import {ManagementSettings} from './management-settings.js';
import {ManagementRuntime} from './management-runtime.js';
import {managementModules} from './management-catalog.js';
import {createManagementDispatch} from './management-dispatch.js';

declare module '@deepseek-ai/cordis' {interface Context {dafeiyuManagement:ManagementController}}
export class ManagementController extends TypertRemoteService {
  readonly runtime:ManagementRuntime;private readonly settings:ManagementSettings;
  private readonly dispatch:ReturnType<typeof createManagementDispatch>;
  constructor(ctx:Context,config:{settingsFile:string;nodePath:string}){
    super(ctx,'dafeiyuManagement');
    this.settings=new ManagementSettings(config.settingsFile);
    this.runtime=new ManagementRuntime(ctx,config);
    this.dispatch=createManagementDispatch({settings:this.settings,runtime:this.runtime,describe:()=>({apiVersion:API_VERSION,version:RELEASE_VERSION,modules:managementModules,
      prompts:[...promptCatalog,{id:'qq-message-sequence',module:'qq',title:'QQ 消息序列与输出契约',position:'context',text:QQ_SEQUENCE_INSTRUCTIONS,condition:'QQ 渠道输出时；固定文字与当前输出 schema'}]})});
    ctx.effect(()=>ctx.typert.remotes.register(managementRemote));
    ctx.effect(()=>()=>this.runtime.dispose());
  }
  @Remote
  async request(payload:string):Promise<string>{
    if(this.ctx.invocation?.peer.principal.kind!=='owner')throw new Error('MANAGEMENT_OWNER_REQUIRED');
    return JSON.stringify(await this.dispatch(payload));
  }
}
