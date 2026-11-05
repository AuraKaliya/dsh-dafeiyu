import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import type {DatabaseSync} from 'node:sqlite';
import type {DependencyRecovery} from '@dafeiyu/contracts';

const permitSchema=z.strictObject({key:z.string(),generation:z.number().int().positive(),requestId:z.uuid(),
  state:z.enum(['armed','running','succeeded','failed','interrupted','stale']),expiresAt:z.number(),updatedAt:z.number()});
export type MediaProbePermit=z.infer<typeof permitSchema>;
type Health={key:string;generation:number;until:number|null;code:string;stage:string};
export const MEDIA_RECOVERY_TABLES=['media_failure_scopes','media_probe_permits'] as const;
export function createMediaRecoverySchema(db:DatabaseSync){db.exec('CREATE TABLE media_failure_scopes(diagnostic_id TEXT PRIMARY KEY,scope_key TEXT NOT NULL,generation INTEGER NOT NULL); CREATE TABLE media_probe_permits(scope_key TEXT PRIMARY KEY,body TEXT NOT NULL);');}

/** A permission to attempt one already-authorized read is never reported as recovered. */
export class MediaRecovery {
  constructor(private readonly db:DatabaseSync,private readonly health:(key:string)=>Health|null,private readonly restore:(key:string,generation:number,now:number)=>boolean){}
  link(id:string,key:string,generation:number){this.db.prepare('INSERT INTO media_failure_scopes VALUES(?,?,?)').run(id,key,generation);}
  private save(permit:MediaProbePermit){this.db.prepare('INSERT INTO media_probe_permits VALUES(?,?) ON CONFLICT(scope_key) DO UPDATE SET body=excluded.body').run(permit.key,JSON.stringify(permitSchema.parse(permit)));}
  permit(key:string){const row=this.db.prepare('SELECT body FROM media_probe_permits WHERE scope_key=?').get(key);return row?permitSchema.parse(JSON.parse(String(row.body))):null;}
  list(){return this.db.prepare('SELECT body FROM media_probe_permits ORDER BY rowid DESC').all().map(row=>permitSchema.parse(JSON.parse(String(row.body))));}
  arm(key:string,generation:number,requestId:string,now=Date.now()){
    const current=this.health(key),old=this.permit(key);
    if(old?.requestId===requestId){if(old.generation!==generation)throw new Error('IDEMPOTENCY_CONFLICT');return old;}
    if(!current||current.generation!==generation||current.until===0)throw new Error('MEDIA_RECOVERY_STALE');
    if(old?.generation===generation&&['armed','running'].includes(old.state)&&old.expiresAt>now)return old;
    const permit:MediaProbePermit={key,generation,requestId,state:'armed',expiresAt:now+120000,updatedAt:now};this.save(permit);return permit;
  }
  state(key:string,generation:number,now=Date.now()):DependencyRecovery{
    const current=this.health(key);if(!current||current.until===0)return {key,generation:current?.generation??generation,state:'recovered',code:current?.code??'MEDIA_CONFIGURATION_CHANGED'};
    const permit=this.permit(key),available=permit?.generation===current.generation&&permit.state==='armed'&&permit.expiresAt>now;
    const occupied=permit?.generation===current.generation&&permit.state==='running'&&permit.expiresAt>now;
    return {key,generation:current.generation,state:!occupied&&(available||current.until!==null&&now>=current.until)?'retry-ready':'blocked',code:current.code};
  }
  dependencies(runId:string){return this.db.prepare('SELECT DISTINCT s.scope_key,s.generation FROM media_failure_scopes s JOIN media_diagnostics d ON d.id=s.diagnostic_id WHERE d.run_id=?').all(runId)
    .map(row=>this.state(String(row.scope_key),Number(row.generation))).filter(row=>row.state!=='recovered');}
  begin(keys:readonly string[],now=Date.now()){
    this.db.exec('SAVEPOINT media_probe');try{const permits:MediaProbePermit[]=[];
      for(const key of new Set(keys)){const health=this.health(key);if(!health||health.until===0)continue;
        if(this.state(key,health.generation,now).state!=='retry-ready')throw new Error('MEDIA_DEPENDENCY_PAUSED');
        const old=this.permit(key),permit=old?.generation===health.generation&&old.state==='armed'&&old.expiresAt>now?old:this.arm(key,health.generation,randomUUID(),now);
        const running:MediaProbePermit={...permit,state:'running',expiresAt:now+900000,updatedAt:now};this.save(running);permits.push(running);
      }this.db.exec('RELEASE media_probe');return permits;
    }catch(error){this.db.exec('ROLLBACK TO media_probe; RELEASE media_probe');throw error;}
  }
  finish(permits:readonly MediaProbePermit[],success:boolean,now=Date.now(),verifiedStages?:ReadonlySet<string>){
    for(const permit of permits){const current=this.permit(permit.key);if(current?.requestId!==permit.requestId||current.state!=='running')continue;
      const health=this.health(permit.key);
      if(health?.generation!==permit.generation){this.save({...current,state:'stale',updatedAt:now});continue;}
      if(success&&verifiedStages&&!verifiedStages.has(health.stage)){this.save({...current,state:'armed',expiresAt:now+120000,updatedAt:now});continue;}
      const restored=success&&this.restore(permit.key,permit.generation,now);this.save({...current,state:restored?'succeeded':'failed',updatedAt:now});}
  }
  interrupt(now=Date.now()){for(const permit of this.list())if(permit.state==='running'||permit.state==='armed')this.save({...permit,state:'interrupted',expiresAt:now,updatedAt:now});}
}
