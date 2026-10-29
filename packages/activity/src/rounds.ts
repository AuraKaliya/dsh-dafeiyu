import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
export const RoundBudgetSchema=z.strictObject({roundTokens:z.number().int().min(1).max(100000000).default(100000),roundDurationMs:z.number().int().min(1).max(86400000).default(900000)});
const roundSchema=z.object({id:z.uuid(),startedAt:z.number(),endedAt:z.number().nullable(),budget:RoundBudgetSchema,reason:z.string().nullable(),restRequested:z.boolean().default(false)});
export function createRoundSchema(db:DatabaseSync){db.exec('CREATE TABLE activity_rounds(id TEXT PRIMARY KEY,body TEXT NOT NULL); CREATE TABLE activity_round_items(occurrence_id TEXT PRIMARY KEY,round_id TEXT NOT NULL REFERENCES activity_rounds(id),settlement TEXT);');}
export class ActivityRounds {
  constructor(private readonly db:DatabaseSync,private settings:z.input<typeof RoundBudgetSchema>,private readonly minIntervalMs:number){}
  configure(raw:unknown){this.settings=RoundBudgetSchema.parse(raw);return {applies:'next-round',budget:this.settings};}
  current(){const row=this.db.prepare("SELECT body FROM activity_rounds WHERE json_extract(body,'$.endedAt') IS NULL ORDER BY rowid DESC LIMIT 1").get();return row?roundSchema.parse(JSON.parse(String(row.body))):null;}
  canStart(now:number){if(this.current())return true;const row=this.db.prepare('SELECT body FROM activity_rounds ORDER BY rowid DESC LIMIT 1').get();return !row||now>=(roundSchema.parse(JSON.parse(String(row.body))).endedAt??now)+this.minIntervalMs;}
  admit(occurrenceId:string,now:number){if(this.db.prepare('SELECT 1 FROM activity_round_items WHERE occurrence_id=?').get(occurrenceId))return;let round=this.current();if(!round){if(!this.canStart(now))throw new Error('ACTIVITY_ROUND_INTERVAL');round={id:randomUUID(),startedAt:now,endedAt:null,budget:RoundBudgetSchema.parse({roundTokens:this.settings.roundTokens,roundDurationMs:this.settings.roundDurationMs}),reason:null,restRequested:false};this.db.prepare('INSERT INTO activity_rounds VALUES(?,?)').run(round.id,JSON.stringify(round));}this.db.prepare('INSERT INTO activity_round_items VALUES(?,?,NULL)').run(occurrenceId,round.id);}
  requestRest(){const current=this.current();if(!current)throw new Error('ACTIVITY_ROUND_REQUIRED');this.db.prepare('UPDATE activity_rounds SET body=? WHERE id=?').run(JSON.stringify({...current,restRequested:true}),current.id);}
  pending(){return this.db.prepare('SELECT occurrence_id FROM activity_round_items WHERE settlement IS NULL').all().map(row=>String(row.occurrence_id));}
  settle(occurrenceId:string,usage:{tokens:number|null;knownTokens:number},durationMs:number,now:number){const row=this.db.prepare('SELECT round_id,settlement FROM activity_round_items WHERE occurrence_id=?').get(occurrenceId);if(!row||row.settlement!==null)return;
    const value=z.object({tokens:z.number().int().nonnegative().nullable(),knownTokens:z.number().int().nonnegative(),durationMs:z.number().nonnegative()}).parse({...usage,durationMs});
    this.db.prepare('UPDATE activity_round_items SET settlement=? WHERE occurrence_id=? AND settlement IS NULL').run(JSON.stringify(value),occurrenceId);
    const current=this.current();if(!current||current.id!==row.round_id)return;const totals=this.totals(current.id);
    if(current.restRequested)this.end('rest',now);else if(totals.unknown)this.end('usage-unknown',now);else if(totals.knownTokens>=current.budget.roundTokens)this.end('token-budget',now);else if(totals.durationMs>=current.budget.roundDurationMs)this.end('time-budget',now);
  }
  totals(id:string){const items=this.db.prepare('SELECT occurrence_id,settlement FROM activity_round_items WHERE round_id=?').all(id);let knownTokens=0,durationMs=0,completed=0,unknown=false;for(const item of items){if(item.settlement===null)continue;const value=z.object({tokens:z.number().nullable(),knownTokens:z.number(),durationMs:z.number()}).parse(JSON.parse(String(item.settlement)));knownTokens+=value.knownTokens;durationMs+=value.durationMs;completed++;unknown ||= value.tokens===null;}return {knownTokens,durationMs,completed,unknown,pending:items.length-completed};}
  end(reason:string,now:number){const current=this.current();if(!current||this.totals(current.id).pending)return;this.db.prepare('UPDATE activity_rounds SET body=? WHERE id=?').run(JSON.stringify({...current,reason,endedAt:now}),current.id);}
  list(){return this.db.prepare('SELECT body FROM activity_rounds ORDER BY rowid DESC LIMIT 50').all().map(row=>{const round=roundSchema.parse(JSON.parse(String(row.body)));return {...round,...this.totals(round.id)};});}
}
