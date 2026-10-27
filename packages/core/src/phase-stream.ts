import type {StreamChunk} from '@deepseek-ai/dsh-llm';

/** A phase deadline also bounds a provider that has not yielded its next chunk. */
export async function* phaseStream(stream:AsyncIterable<StreamChunk>,signal:AbortSignal):AsyncIterable<StreamChunk>{
  const iterator=stream[Symbol.asyncIterator]();
  try{for(;;){signal.throwIfAborted();let abort!:()=>void;
    const cancelled=new Promise<never>((_resolve,reject)=>{abort=()=>reject(signal.reason);signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();});
    let result:IteratorResult<StreamChunk>;try{result=await Promise.race([iterator.next(),cancelled]);}finally{signal.removeEventListener('abort',abort);}
    signal.throwIfAborted();if(result.done)return;yield result.value;
  }}finally{const closing=iterator.return?.();if(signal.aborted)void closing?.catch(()=>{});else await closing;}
}
