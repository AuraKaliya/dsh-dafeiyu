interface HostReady {onReady(listener:()=>void):()=>void}
type Dispose=()=>void|Promise<void>;
function isHostReady(value:unknown):value is HostReady{return !!value&&typeof value==='object'&&'onReady'in value&&typeof value.onReady==='function';}

/** Keep lazy imports and child creation outside the host's startup barrier. */
export function deferPluginStart(ready:unknown,launch:(signal:AbortSignal)=>Promise<Dispose>,failed:(error:unknown)=>void):()=>Promise<void>{
  if(ready!==undefined&&!isHostReady(ready))throw new Error('INSTALL_DSH_READINESS_INVALID');
  const controller=new AbortController();let running:Promise<Dispose>|undefined,closing:Promise<void>|undefined;
  const start=()=>{if(controller.signal.aborted||running)return;running=Promise.resolve().then(()=>{controller.signal.throwIfAborted();return launch(controller.signal);});void running.catch(error=>{if(!controller.signal.aborted)failed(error);});};
  const cancel=isHostReady(ready)?ready.onReady(start):undefined;if(ready===undefined)start();
  return ()=>closing??=(async()=>{controller.abort();cancel?.();const dispose=await running?.catch(()=>undefined);await dispose?.();})();
}
