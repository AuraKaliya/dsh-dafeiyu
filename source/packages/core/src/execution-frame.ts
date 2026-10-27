import type { Context } from '@deepseek-ai/cordis';
import type { Agent } from '@deepseek-ai/dsh-agent';
import type { ExecutionInput,ExecutionView,PersonaSnapshot,PendingMessage,ContextItem } from '@dafeiyu/contracts';
import type { BoundAction,RuntimeDelivery } from './runtime.js';
import type { BoundActionV3 } from './registry-v3.js';
import type { Json } from '@dafeiyu/contracts';
import type { ExecutionToolReceipt,SourceDependency } from '@dafeiyu/contracts';
import type { ExecutionEvidence,NativeContext } from './execution-evidence.js';

export interface NativeAction {
  definition:BoundActionV3;
  execute(input:unknown,callId:string,signal:AbortSignal):Promise<Json>;
  metadata?(value:Json):ExecutionToolReceipt|undefined;
}
export interface TaskExecutionFrame {
  assessmentTimeoutMs?:number;
  mode:'task';sessionId:string;view:ExecutionView;persona:PersonaSnapshot;goal:string;inputs:readonly ExecutionInput[];
  actions:readonly NativeAction[];guard:()=>void;requestMaxBytes:number;outputReserveBytes:number;
  personaItems?:readonly ContextItem[];
  program?:Json;contexts?:readonly NativeContext[];evidence?:ExecutionEvidence;
  audit?:(data:Record<string,Json>)=>void;
  checkpoint?:(sessionId:string,throughSeq:number,dependencies:readonly SourceDependency[],text:string)=>void;
  /** Source-aware context/compaction binds in 1E, with the same final admission guard. */
  prepare?:(scope:Context,agent:Agent)=>Promise<()=>void>;
}
export interface ConversationExecutionFrame {
  mode:'conversation'|'delivery-v2';item:PendingMessage;persona:PersonaSnapshot;actions:readonly BoundAction[];
  signal:AbortSignal;channelDescription:string;delivery?:RuntimeDelivery;
  nativeActions?:readonly NativeAction[];
  allowEmpty?:()=>boolean;
}
export type ExecutionFrame=TaskExecutionFrame|ConversationExecutionFrame;
