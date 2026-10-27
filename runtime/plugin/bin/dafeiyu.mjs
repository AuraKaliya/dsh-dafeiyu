#!/usr/bin/env node
import {existsSync,readFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {readInstallationSettings,checkInstallationFiles,SettingsError} from '../lib/settings.js';

const args=process.argv.slice(2),mode=args[0];
const report=value=>{console.log(JSON.stringify(value));if(process.connected)process.send(value);};
if(!mode||['--help','-h'].includes(mode)){
  report({name:'大肥鱼',commands:['check --settings <file>','init --settings <file>','start --settings <file>','status --settings <file>']});
}else{
  try{
    if(!['check','init','start','status'].includes(mode)||args.length!==3||args[1]!=='--settings')throw new Error('INSTALL_ARGUMENT_INVALID');
    const major=Number(process.versions.node.split('.')[0]),minor=Number(process.versions.node.split('.')[1]);if(major!==24||minor<13)throw new Error('INSTALL_NODE_24_REQUIRED');
    const file=resolve(args[2]),settings=readInstallationSettings(file);
    if(mode==='start'&&settings.dshTools&&!process.connected)throw new Error('INSTALL_DSH_DESKTOP_REQUIRED');
    if(mode==='start'&&settings.dshTools&&process.env.DAFEIYU_DSH_BRIDGE!=='1')throw new Error('INSTALL_DSH_RELOAD_REQUIRED');
    if(mode==='check'){
      checkInstallationFiles(settings);report({code:'INSTALL_CONFIGURATION_VALID',connectivity:'not-tested',modelCalls:0});
    }else{
      process.env.DSH_HOME=join(settings.dataDir,'core','dsh-home');
      if(mode==='status'){
        const {loadHostConfig,readHostStatus}=await import('#dafeiyu/host');
        const config=join(settings.dataDir,'configuration','host.json');if(!existsSync(config))report({code:'INSTALL_NOT_INITIALIZED'});else report(readHostStatus(loadHostConfig(config)));
      }else{
        const {prepareInstallation,startInstallation}=await import('../lib/installation.js');
        if(mode==='init'){const value=prepareInstallation(file);report({code:value.inspection.ready?'INSTALL_INITIALIZED':'INSTALL_NOT_READY',issues:value.inspection.codes});if(!value.inspection.ready)process.exitCode=1;}
        else{
          const abort=new AbortController();let host;const stop=()=>{abort.abort();void host?.close('plugin-stopped');};
          process.once('SIGINT',stop);process.once('SIGTERM',stop);process.once('disconnect',stop);process.on('message',message=>{if(message?.type==='stop')stop();else if(message?.type==='dsh.capability-change'){if(!host||host.core.taskDeliveryBusy())return;try{host.core.reconcileCapabilityChange(message.change);}catch{report({code:'DSH_CAPABILITY_RESUME_REJECTED'});}if(process.connected&&typeof message.key==='string')process.send({type:'dsh.capability-change-ack',key:message.key});}else if(message?.type==='dsh.validate-update'&&process.connected){let valid=false;try{valid=host?.core.externalTaskSourceCurrent(message.authorization,'dsh-tools')===true&&!host.core.taskDeliveryBusy();}catch{}process.send({type:'dsh.update-authority-result',id:message.id,valid});}});
          const {createDshBridgeClient}=await import('../lib/bridge-client.js');
          try{host=await startInstallation(file,{}, {signal:abort.signal,...(process.connected&&settings.dshTools?{dshTools:createDshBridgeClient()}:{})});report({code:'INSTALL_READY',phase:host.snapshot().phase});const heartbeat=setInterval(()=>{if(!process.connected)return;const snapshot=host.snapshot();process.send({type:'dsh.idle',idle:snapshot.phase==='ready'&&!host.core.taskDeliveryBusy()&&Object.values(snapshot.counts).every(value=>value===0)});},1500);try{await host.whenClosed();}finally{clearInterval(heartbeat);}report({code:'INSTALL_STOPPED'});}
          finally{await host?.close('command-ended');process.off('SIGINT',stop);process.off('SIGTERM',stop);process.off('disconnect',stop);process.removeAllListeners('message');if(process.connected)process.disconnect();}
        }
      }
    }
  }catch(error){report({code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'INSTALL_FAILED',...(error instanceof SettingsError?{fields:error.fields}:{})});process.exitCode=1;if(process.connected)process.disconnect();}
}
