import type { PersonaAccess,PersonaTrialAuthority } from '@dafeiyu/contracts';
import { runtimeHash } from './runtime-store.js';

interface Grant {readonly inputHash:string;readonly verify:()=>void;readonly access:PersonaAccess}
function freeze(value:unknown):void{if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}}
/** A guard function is not a grant: identity and the exact callback payload are checked separately. */
export class PersonaTrialAuthorities {
  private readonly grants=new WeakMap<object,Grant>();
  invoke<Input,Result>(input:Input,access:PersonaAccess,verify:()=>void,receive:(input:Input,authority:PersonaTrialAuthority)=>Result):Result{
    const fixed=structuredClone(input);freeze(fixed);const inputHash=runtimeHash(fixed);
    const authority:PersonaTrialAuthority=Object.freeze({guard:()=>this.assert(authority,fixed)});
    const trusted=Object.freeze({...access,guard:authority.guard,commitGuard:authority.guard});
    this.grants.set(authority,{inputHash,verify:()=>{access.guard();verify();},access:trusted});
    try{authority.guard();return receive(fixed,authority);}finally{this.grants.delete(authority);}
  }
  assert(authority:unknown,input:unknown):void{
    const grant=authority&&typeof authority==='object'?this.grants.get(authority):undefined;
    let hash:string|null=null;try{hash=runtimeHash(input);}catch{/* Non-JSON input cannot carry a callback grant. */}
    if(!grant||hash!==grant.inputHash)throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID');grant.verify();
  }
  access(authority:unknown,input:unknown):PersonaAccess{this.assert(authority,input);const grant=authority&&typeof authority==='object'?this.grants.get(authority):undefined;
    if(!grant)throw new Error('PERSONA_TRIAL_AUTHORITY_INVALID');return grant.access;
  }
}
