import type {DatabaseSync} from 'node:sqlite';
import {conversationKey,ConversationSchema,ExpressionPolicySchema} from '@dafeiyu/contracts';
import type {Conversation,PersonaSourceRef} from '@dafeiyu/contracts';
import {z} from 'zod';
import type {MemoryStore} from './store.js';
import {TaskWorkspace,witnessSchema} from './task-workspace.js';
import type {Witness} from './task-workspace.js';
import {digest,canonical} from './retrieval-profile.js';
const text=(v:unknown)=>z.string().parse(v),integer=(v:unknown)=>z.number().int().parse(v),hash=(v:unknown)=>digest(canonical(z.json().parse(v)));
const policyBodySchema=z.strictObject({input:ExpressionPolicySchema,proofs:z.array(witnessSchema)});
type Packet={policy:{id:string;version:number}|null};
/** Checks whether existing memory may be expressed to the concrete channel target. */
export class MemoryExpressionAccess {
  constructor(private readonly db:DatabaseSync,private readonly store:MemoryStore,private readonly tasks:TaskWorkspace){}
  private expressionPolicy(agentId:string,ref:Packet['policy'],target:Conversation){if(!ref)return null;
    const row=this.db.prepare('SELECT * FROM expression_policies WHERE agent_id=? AND id=?').get(agentId,ref.id);if(!row||row.version!==ref.version)throw new Error('expression_policy_unavailable');
    const policy=policyBodySchema.parse(JSON.parse(text(row.body)));if(!policy.input.enabled||conversationKey(agentId,policy.input.target)!==conversationKey(agentId,target))throw new Error('expression_policy_unavailable');return policy;}
  private allowed(agentId:string,proof:Witness,target:Conversation,policy:ReturnType<MemoryExpressionAccess['expressionPolicy']>):boolean{
    if(!this.tasks.validProof(agentId,proof))return false;const scope={agentId,route:proof.route},targetRoute=conversationKey(agentId,target);
    if(proof.kind==='observation')return proof.route===targetRoute&&!!this.store.observations.activity(scope,proof.id,'expression');
    // Internal grant validity and original expression restrictions are both required.
    if(!this.store.read(scope,proof.id,'normal',proof.revision,'expression'))return false;
    if(proof.route===targetRoute)return true;
    const {authorization:_authorization,range:_range,...base}=proof;
    return !!policy?.proofs.some(p=>hash(p)===hash(base)&&this.tasks.validProof(agentId,p));
  }
  nativeMemoryMaterial(agentId:string,ref:PersonaSourceRef,target:Conversation,policy:Packet['policy']):string|null{
    if(ref.kind!=='memory'||ref.agentId!==agentId)return null;const scope={agentId,route:ref.scopeKey},memory=this.store.read(scope,ref.id,'normal',ref.revision,'expression'),proof=this.tasks.memoryProof(scope,ref.id,ref.revision,ref.version,ref.contentHash);
    if(!memory||memory.version!==ref.version||memory.contentHash!==ref.contentHash||!proof||!this.allowed(agentId,proof,target,this.expressionPolicy(agentId,policy,target)))return null;
    return ref.range?Array.from(memory.content).slice(ref.range.start,ref.range.end).join(''):memory.content;
  }

}
