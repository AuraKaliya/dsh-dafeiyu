import {setImmediate as yieldEventLoop} from 'node:timers/promises';
/** Yield to timers/IPC during a buffered stream; this is not a task step or token limit. */
export async function* cooperativeStream<T>(source:AsyncIterable<T>,signal?:AbortSignal):AsyncIterable<T>{
  let nextYield=performance.now()+16;
  for await(const value of source){signal?.throwIfAborted();if(performance.now()>=nextYield){await yieldEventLoop();signal?.throwIfAborted();nextYield=performance.now()+16;}yield value;}
}
