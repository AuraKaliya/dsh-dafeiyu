import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ExecutionInput,ExecutionView,PersonaSnapshot,PendingMessage,ContextItem } from '@dafeiyu/contracts';
import type { BoundAction,RuntimeDelivery } from './runtime.js';
import type { BoundActionV3 } from './registry-v3.js';
import type { Json } from '@dafeiyu/contracts';

export interface NativeAction {
  definition:BoundActionV3;
  execute(input:unknown,callId:string,signal:AbortSignal):Promise<Json>;
}
export interface TaskExecutionFrame {
  mode:'task';sessionId:string;view:ExecutionView;persona:PersonaSnapshot;goal:string;inputs:readonly ExecutionInput[];
  actions:readonly NativeAction[];guard:()=>void;requestMaxBytes:number;outputReserveBytes:number;
  personaItems?:readonly ContextItem[];
  /** Source-aware context/compaction binds in 1E, with the same final admission guard. */
  prepare?:(scope:Context,agent:Agent)=>Promise<()=>void>;
}
export interface ConversationExecutionFrame {
  mode:'conversation'|'delivery-v2';item:PendingMessage;persona:PersonaSnapshot;actions:readonly BoundAction[];
  signal:AbortSignal;channelDescription:string;delivery?:RuntimeDelivery;
  nativeActions?:readonly NativeAction[];
}
export type ExecutionFrame=TaskExecutionFrame|ConversationExecutionFrame;
