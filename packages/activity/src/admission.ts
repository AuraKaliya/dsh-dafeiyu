import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';

const gateSchema=z.strictObject({until:z.number().int().nonnegative().nullable(),reason:z.string(),generation:z.number().int().nonnegative(),updatedAt:z.number().int().nonnegative()});
const candidateSchema=z.strictObject({key:z.string(),revision:z.string(),state:z.enum(['claimed','complete','blocked']),claim:z.string(),runId:z.string().nullable(),updatedAt:z.number().int().nonnegative(),retryAt:z.number().int().nonnegative().nullable(),result:z.json().nullable()});
export const ACTIVITY_ADMISSION_TABLES=['activity_control','activity_explorations','activity_patrol_cursors','activity_patrol_receipts'] as const;
export function createAdmissionSchema(db:DatabaseSync){db.exec('CREATE TABLE activity_control(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE activity_explorations(key TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE activity_patrol_cursors(plan_id TEXT NOT NULL,route TEXT NOT NULL,cursor INTEGER NOT NULL,PRIMARY KEY(plan_id,route)); CREATE TABLE activity_patrol_receipts(id TEXT PRIMARY KEY,plan_id TEXT NOT NULL,body TEXT NOT NULL);');}

/** Durable scheduling gates; no model call is needed to test a rest, failure or unchanged candidate. */
export class ActivityAdmission {
  constructor(private readonly db:DatabaseSync){}
  gate(key:string){const row=this.db.prepare('SELECT body FROM activity_control WHERE key=?').get(key);return row?gateSchema.parse(JSON.parse(String(row.body))):null;}
  block(key:string,reason:string,until:number|null,now:number){const old=this.gate(key),next=gateSchema.parse({until,reason,generation:(old?.generation??0)+1,updatedAt:now});this.db.prepare('INSERT INTO activity_control VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(next));return next;}
  allowed(key:string,now:number){const gate=this.gate(key);return !gate||gate.until!==null&&now>=gate.until;}
  restore(key:string,expectedGeneration:number,now:number){const old=this.gate(key);if(!old||old.generation!==expectedGeneration)return false;this.block(key,'restored',now,now);return true;}
  postpone(key:string,expectedGeneration:number,until:number|null,now:number){const old=this.gate(key);if(!old||old.generation!==expectedGeneration||old.reason==='restored')return false;this.db.prepare('UPDATE activity_control SET body=? WHERE key=?').run(JSON.stringify({...old,until,updatedAt:now}),key);return true;}
  read(key:string){const row=this.db.prepare('SELECT body FROM activity_explorations WHERE key=?').get(key);return row?candidateSchema.parse(JSON.parse(String(row.body))):null;}
  claim(key:string,revision:string,now:number){
    this.db.exec('BEGIN IMMEDIATE');try{
      const prior=this.read(key);
      if(prior&&prior.revision===revision&&(prior.state==='complete'||prior.state==='claimed'||prior.retryAt===null||now<prior.retryAt)){this.db.exec('COMMIT');return null;}
      const next=candidateSchema.parse({key,revision,state:'claimed',claim:randomUUID(),runId:null,updatedAt:now,retryAt:null,result:null});
      this.db.prepare('INSERT INTO activity_explorations VALUES(?,?) ON CONFLICT(key) DO UPDATE SET body=excluded.body').run(key,JSON.stringify(next));this.db.exec('COMMIT');return next;
    }catch(error){this.db.exec('ROLLBACK');throw error;}
  }
  bind(key:string,claim:string,runId:string,now:number){const current=this.read(key);if(!current||current.claim!==claim||current.state!=='claimed')throw new Error('ACTIVITY_CANDIDATE_STALE');this.save({...current,runId,updatedAt:now});}
  reclaim(key:string,expectedClaim:string,claim:string,now:number){const current=this.read(key);if(!current||current.claim!==expectedClaim||current.state!=='blocked')throw new Error('ACTIVITY_CANDIDATE_STALE');this.save({...current,state:'claimed',claim,runId:null,retryAt:null,updatedAt:now});}
  settle(key:string,claim:string,state:'complete'|'blocked',result:unknown,retryAt:number|null,now:number){const current=this.read(key);if(!current||current.claim!==claim)return false;this.save({...current,state,result:z.json().parse(result),retryAt,updatedAt:now});return true;}
  releaseUnstarted(key:string,claim:string,now:number){const current=this.read(key);if(!current||current.claim!==claim||current.runId)return false;return this.settle(key,claim,'blocked',null,now,now);}
  private save(raw:z.input<typeof candidateSchema>){const value=candidateSchema.parse(raw);this.db.prepare('UPDATE activity_explorations SET body=? WHERE key=?').run(JSON.stringify(value),value.key);}
  list(){return this.db.prepare('SELECT body FROM activity_explorations ORDER BY rowid DESC').all().map(row=>candidateSchema.parse(JSON.parse(String(row.body))));}
  gates(){return this.db.prepare('SELECT key,body FROM activity_control ORDER BY key').all().map(row=>({key:String(row.key),...gateSchema.parse(JSON.parse(String(row.body)))}));}
}
