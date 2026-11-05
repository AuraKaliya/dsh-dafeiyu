import type {DatabaseSync} from 'node:sqlite';
import {z} from 'zod';

const resumeSchema=z.strictObject({requestId:z.uuid(),taskId:z.uuid(),expectedVersion:z.number().int().positive(),policyId:z.string(),parentRunId:z.uuid(),checkpointId:z.uuid()});
const recoverySchema=z.strictObject({id:z.uuid(),key:z.string(),revision:z.string(),claim:z.uuid(),parentRunId:z.uuid(),generation:z.number().int().positive(),dependencyKey:z.string().min(1),
  attempt:z.number().int().nonnegative(),state:z.enum(['blocked','claimed','settled','held']),code:z.string().nullable(),updatedAt:z.number(),
  workId:z.uuid().nullable(),resume:resumeSchema.nullable()});
const probeSchema=z.strictObject({id:z.uuid(),generation:z.number().int().positive(),automatic:z.boolean(),startedAt:z.number(),finishedAt:z.number().nullable(),
  state:z.enum(['running','succeeded','failed','interrupted','stale']),code:z.string().nullable()});
export type ExplorationRecovery=z.infer<typeof recoverySchema>;
export type ModelRecoveryProbe=z.infer<typeof probeSchema>;
export const ACTIVITY_RECOVERY_TABLES=['activity_recoveries','activity_recovery_probes'] as const;
export const MAX_RECOVERY_ATTEMPTS=3;
export function createRecoverySchema(db:DatabaseSync){db.exec('CREATE TABLE activity_recoveries(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE activity_recovery_probes(id TEXT PRIMARY KEY,body TEXT NOT NULL);');}

/** Durable resume intents precede Core acceptance; repeated acceptance uses the same request id. */
export class ActivityRecoveryStore {
  constructor(private readonly db:DatabaseSync){}
  get(id:string){const row=this.db.prepare('SELECT body FROM activity_recoveries WHERE id=?').get(id);return row?recoverySchema.parse(JSON.parse(String(row.body))):null;}
  list(){return this.db.prepare('SELECT body FROM activity_recoveries ORDER BY rowid').all().map(row=>recoverySchema.parse(JSON.parse(String(row.body))));}
  byWork(id:string){const row=this.db.prepare("SELECT body FROM activity_recoveries WHERE json_extract(body,'$.workId')=?").get(id);return row?recoverySchema.parse(JSON.parse(String(row.body))):null;}
  save(raw:ExplorationRecovery){const value=recoverySchema.parse(raw);this.db.prepare('INSERT INTO activity_recoveries VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(value.id,JSON.stringify(value));}
  hold(id:string,code:string,now:number){const current=this.get(id);if(current)this.save({...current,state:'held',code,updatedAt:now});}
  probes(){return this.db.prepare('SELECT body FROM activity_recovery_probes ORDER BY rowid DESC').all().map(row=>probeSchema.parse(JSON.parse(String(row.body))));}
  probe(id:string){const row=this.db.prepare('SELECT body FROM activity_recovery_probes WHERE id=?').get(id);return row?probeSchema.parse(JSON.parse(String(row.body))):null;}
  saveProbe(raw:ModelRecoveryProbe){const value=probeSchema.parse(raw);this.db.prepare('INSERT INTO activity_recovery_probes VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(value.id,JSON.stringify(value));}
  interruptProbes(now:number){for(const probe of this.probes())if(probe.state==='running')this.saveProbe({...probe,state:'interrupted',finishedAt:now,code:'ACTIVITY_PROBE_INTERRUPTED'});}
}
