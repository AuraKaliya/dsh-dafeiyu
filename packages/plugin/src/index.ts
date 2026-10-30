import type {Context} from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import {ManagementController} from './management.js';
import {deferPluginStart} from './startup.js';
export const name='dsh-dafeiyu';
export const inject=['agents','tools','sessions','sessionPersistence','typert'];
export interface Config {settingsFile:string;nodePath:string;startOnLoad:boolean}
export const Config:Schema<Config>=Schema.object({settingsFile:Schema.string().default('').description('大肥鱼配置文件绝对路径；管理中心始终可在设置中打开。'),nodePath:Schema.string().default('node').description('Node.js 24.13+ 可执行文件。'),startOnLoad:Schema.boolean().default(false).description('插件加载后立即启动管理中心运行实例，不等待 appReady；用于受管理的本地部署。')});
export function apply(ctx:Context,config:Config){const management=new ManagementController(ctx,config);
  if(config.startOnLoad&&config.settingsFile){ctx.effect(()=>{void management.runtime.control('start').catch(error=>ctx.logger.warn('INSTALL_START_FAILED：'+String(error instanceof Error?error.message:error)));return ()=>management.runtime.dispose();});return;}
  ctx.effect(()=>deferPluginStart(ctx.get('appReady'),async signal=>{signal.throwIfAborted();if(config.settingsFile)await management.runtime.control('start');return ()=>management.runtime.dispose();},()=>ctx.logger.warn('INSTALL_START_FAILED：在大肥鱼管理中心查看并修正配置。')));}
