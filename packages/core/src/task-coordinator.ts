import { z } from 'zod';
import { TaskMemoryPolicySchema,TaskMemoryGrantSchema,TaskMemoryRevokeSchema,TaskMemoryQuerySchema,TaskMemoryOpenSchema,TaskMemorySelectSchema } from '@dafeiyu/contracts';
import type { TaskMemoryProvider,TaskMemoryAccess } from '@dafeiyu/contracts';
import { ConversationSchema,MemoryObservationSchema,TaskCreateSchema,TaskUpdateSchema,TaskSceneSchema,TaskActivateSchema,TaskLinkSchema,TaskBeginSchema,TaskCompleteSchema } from '@dafeiyu/contracts';
import type { TaskReference,TaskController,TaskWorkTicket,TaskPluginAPI,TaskWorkspaceProvider,ObservationAuthority,Conversation,ActionContext } from '@dafeiyu/contracts';

export function bindTaskMemoryProvider(p:TaskMemoryProvider):TaskMemoryProvider{return {policy:p.policy.bind(p),grant:p.grant.bind(p),check:p.check.bind(p),revoke:p.revoke.bind(p),recall:p.recall.bind(p),open:p.open.bind(p),select:p.select.bind(p)};}
export function bindTaskProvider(p:TaskWorkspaceProvider):TaskWorkspaceProvider {return {
  current:p.current.bind(p),
  create:p.create.bind(p),read:p.read.bind(p),update:p.update.bind(p),join:p.join.bind(p),activate:p.activate.bind(p),link:p.link.bind(p),begin:p.begin.bind(p),
  observe:p.observe.bind(p),complete:p.complete.bind(p),view:p.view.bind(p),
};}

/** Non-model coordinator capabilities. Scene handlers receive references/tickets, never
 * the coordinator's private read function or a caller-selectable global scope. */
export class TaskCoordinator {
  private readonly references=new WeakMap<TaskReference,{id:string;provider:TaskWorkspaceProvider}>();
  private readonly jobs=new WeakMap<TaskWorkTicket,{id:string;provider:TaskWorkspaceProvider;issuer:object;authority:ObservationAuthority}>();
  constructor(private readonly agentId:string,private readonly provider:()=>TaskWorkspaceProvider|undefined,private readonly assertOpen:()=>void,private readonly memoryProvider:()=>TaskMemoryProvider|undefined){}
  private memory(){this.assertOpen();const p=this.memoryProvider();if(!p)throw new Error('Task memory provider unavailable');return p;}
  policy(raw:unknown){return this.memory().policy(this.agentId,TaskMemoryPolicySchema.parse(raw));}
  private access(reference:TaskReference,grantId:string,p:TaskMemoryProvider):TaskMemoryAccess {
    const guard=()=>{this.reference(reference);if(this.memory()!==p)throw new Error('Task memory capability expired');p.check(this.agentId,reference.id,grantId);};guard();
    return Object.freeze({id:grantId,recall:async(raw:unknown,signal:AbortSignal=AbortSignal.timeout(30000))=>{guard();const result=await p.recall(this.agentId,reference.id,grantId,TaskMemoryQuerySchema.parse(raw),signal,guard);guard();return result;},
      open:(raw:unknown)=>{guard();return p.open(this.agentId,reference.id,grantId,TaskMemoryOpenSchema.parse(raw));},
      select:(raw:unknown)=>{guard();return p.select(this.agentId,reference.id,grantId,TaskMemorySelectSchema.parse(raw));}});
  }
  private current(){this.assertOpen();const provider=this.provider();if(!provider)throw new Error('Task workspace provider unavailable');return provider;}
  private reference(value:TaskReference){const provider=this.current(),ref=this.references.get(value);if(!ref||ref.provider!==provider)throw new Error('No current core-issued task reference');return ref;}
  create(raw:unknown):TaskController {const provider=this.current(),id=provider.create(this.agentId,TaskCreateSchema.parse(raw));return this.wrap(id,provider);}
  resume(id:string):TaskController {const provider=this.current();z.uuid().parse(id);provider.read(this.agentId,id);return this.wrap(id,provider);}
  private wrap(id:string,provider:TaskWorkspaceProvider):TaskController {
    const reference=Object.freeze({id});this.references.set(reference,{id,provider});
    const memory=Object.freeze({grant:(raw:unknown)=>{this.reference(reference);const p=this.memory();return this.access(reference,p.grant(this.agentId,id,TaskMemoryGrantSchema.parse(raw)),p);},
      resume:(grantId:string)=>{this.reference(reference);return this.access(reference,z.uuid().parse(grantId),this.memory());},
      revoke:(raw:unknown)=>{this.reference(reference);return this.memory().revoke(this.agentId,id,TaskMemoryRevokeSchema.parse(raw));}});
    return Object.freeze({reference,memory,read:()=>{this.reference(reference);return provider.read(this.agentId,id);},
      update:(raw:unknown)=>{this.reference(reference);return provider.update(this.agentId,id,TaskUpdateSchema.parse(raw));}});
  }
  forExtension(authorize:(c:Conversation,context?:ActionContext)=>ObservationAuthority,assertActive:()=>void):TaskPluginAPI {
    const issuer={};
    const ticket=(value:TaskWorkTicket)=>{assertActive();const provider=this.current(),job=this.jobs.get(value);if(!job||job.issuer!==issuer||job.provider!==provider)throw new Error('No current producer work ticket');return job;};
    return {
      join:(task,raw,context)=>{const input=TaskSceneSchema.parse(raw),authority=authorize(input.conversation,context),ref=this.reference(task);return ref.provider.join(authority,ref.id,input);},
      activate:(task,raw,context)=>{const input=TaskActivateSchema.parse(raw),authority=authorize(input.conversation,context),provider=this.current(),ref=task?this.reference(task):null;return provider.activate(authority,ref?.id??null,input);},
      link:(task,raw,context)=>{const input=TaskLinkSchema.parse(raw),authority=authorize(input.conversation,context),ref=this.reference(task);return ref.provider.link(authority,ref.id,input);},
      begin:(task,raw,context)=>{const input=TaskBeginSchema.parse(raw),authority=authorize(input.conversation,context),ref=this.reference(task),id=ref.provider.begin(authority,ref.id,input),work=Object.freeze({id});this.jobs.set(work,{id,provider:ref.provider,issuer,authority});return work;},
      observe:(work,raw)=>{const job=ticket(work);return job.provider.observe(job.authority,job.id,MemoryObservationSchema.parse(raw));},
      complete:(work,raw)=>{const job=ticket(work);return job.provider.complete(job.authority,job.id,TaskCompleteSchema.parse(raw));},
      view:(task,conversation,context)=>{const authority=authorize(ConversationSchema.parse(conversation),context),ref=this.reference(task);return ref.provider.view(authority,ref.id);},
    };
  }
}
