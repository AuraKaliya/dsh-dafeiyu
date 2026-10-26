import type { ChildProcess,Serializable } from 'node:child_process';
import { z } from 'zod';
import type { ExecutorIpcEndpoint } from './protocol.js';

interface NodeIpc {readonly connected?:boolean;send?:((value:Serializable,callback:(error:Error|null)=>void)=>boolean)|undefined;
  on(event:'message',listener:(value:unknown)=>void):unknown;on(event:'disconnect',listener:()=>void):unknown;
  removeListener(event:'message',listener:(value:unknown)=>void):unknown;removeListener(event:'disconnect',listener:()=>void):unknown;disconnect?:()=>void}
function endpoint(node:NodeIpc):ExecutorIpcEndpoint{
  if(typeof node.send!=='function'||!node.connected)throw new Error('EXECUTOR_IPC_REQUIRED');
  return {send:async raw=>{const value=z.record(z.string(),z.json()).parse(raw);if(!node.connected||!node.send)throw new Error('EXECUTOR_IPC_CLOSED');
      await new Promise<void>((resolve,reject)=>{try{node.send!(value,error=>error?reject(new Error('EXECUTOR_IPC_SEND_FAILED')):resolve());}catch{reject(new Error('EXECUTOR_IPC_SEND_FAILED'));}});},
    subscribe:(message,disconnected)=>{node.on('message',message);node.on('disconnect',disconnected);return ()=>{node.removeListener('message',message);node.removeListener('disconnect',disconnected);};},
    disconnect:()=>{if(node.connected)node.disconnect?.();}};
}
export const parentIpcEndpoint=(child:ChildProcess):ExecutorIpcEndpoint=>endpoint(child);
export const childIpcEndpoint=():ExecutorIpcEndpoint=>endpoint({
  get connected(){return process.connected;},
  send:(value,callback)=>{if(!process.send)throw new Error('EXECUTOR_IPC_REQUIRED');return process.send(value,undefined,undefined,callback);},
  on:process.on.bind(process),removeListener:process.removeListener.bind(process),disconnect:()=>process.disconnect?.(),
});
