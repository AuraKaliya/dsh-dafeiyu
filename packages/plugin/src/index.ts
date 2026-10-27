import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { isAbsolute } from 'node:path';
import { attachDshBridge } from './bridge-parent.js';
import { readInstallationSettings } from './settings.js';

export const name='dsh-dafeiyu';
export const inject=['agents','tools','sessions','sessionPersistence'];
export interface Config {settingsFile:string;nodePath:string}
export const Config:Schema<Config>=Schema.object({
  settingsFile:Schema.string().default('').description('大肥鱼配置文件的绝对路径。请复制随包提供的配置样例，填写模型、主人QQ、机器人QQ和OneBot连接。'),
  nodePath:Schema.string().default('node').description('Node.js 24.13+可执行文件；已加入PATH时保持node。'),
});

/** A dedicated process prevents the desktop DSH_HOME and agent registry from being overwritten. */
export function apply(ctx:Context,config:Config) {
  if(!config.settingsFile){ctx.logger.info('大肥鱼尚未配置。请填写 settingsFile 后启用；没有启动模型或平台连接。');return;}
  if(!isAbsolute(config.settingsFile))throw new Error('INSTALL_SETTINGS_ABSOLUTE_PATH_REQUIRED');
  let bridgeEnabled=false;try{bridgeEnabled=readInstallationSettings(config.settingsFile).dshTools;}catch{ctx.logger.warn('INSTALL_CONFIGURATION_REQUIRED：请检查大肥鱼配置文件。');return;}
  return ctx.effect(()=>{
    const child=spawn(config.nodePath,[fileURLToPath(new URL('../bin/dafeiyu.mjs',import.meta.url)),'start','--settings',config.settingsFile],{windowsHide:true,env:{...process.env,DAFEIYU_DSH_BRIDGE:bridgeEnabled?'1':''},stdio:['ignore','ignore','ignore','ipc']});
    const closeBridge=bridgeEnabled?attachDshBridge(ctx,child,config.settingsFile):async()=>{};
    let closed=false;const finished=new Promise<void>(resolve=>{child.once('close',()=>{closed=true;resolve();});child.once('error',()=>{ctx.logger.error('INSTALL_NODE_UNAVAILABLE：请检查Node.js路径与版本。');closed=true;resolve();});});
    child.on('message',(value:unknown)=>{if(!value||typeof value!=='object'||!('code' in value)||typeof value.code!=='string'||!/^[A-Z][A-Z0-9_]{0,99}$/.test(value.code))return;
      if(value.code==='INSTALL_READY')ctx.logger.info('大肥鱼已启动；QQ连接和独立状态就绪。');else{
        const fields='fields' in value&&Array.isArray(value.fields)?value.fields.filter((field:unknown)=>typeof field==='string'&&/^[A-Za-z0-9_.]{1,100}$/.test(field)).slice(0,20):[];
        ctx.logger.warn(value.code+(fields.length?'：请检查 '+fields.join(', '):''));}});
    return async()=>{if(closed){await closeBridge();return;}if(child.connected)child.send({type:'stop'});
      let timer:ReturnType<typeof setTimeout>|undefined;
      try{await Promise.race([finished,new Promise<void>(resolve=>{timer=setTimeout(resolve,40000);})]);if(!closed){child.kill();await finished;}}finally{if(timer)clearTimeout(timer);await closeBridge();}};
  });
}
