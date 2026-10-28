import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { MediaReplyAuthoritySchema,MediaAssetRefSchema,MediaSourceDescriptionSchema,ExecutionScopeSchema,ReplyMediaManifestSchema } from '@dafeiyu/contracts';
import type { PersonaAccess,ReplyMediaManifest } from '@dafeiyu/contracts';

export const MEDIA_REPLY_TABLES=['media_reply_drafts','media_reply_heads','media_reply_exports'] as const;
export function createMediaReplySchema(db:DatabaseSync){
  db.exec(`CREATE TABLE media_reply_drafts(id TEXT PRIMARY KEY,run_id TEXT NOT NULL,version INTEGER NOT NULL,body TEXT NOT NULL,body_hash TEXT NOT NULL,UNIQUE(run_id,version));
    CREATE TABLE media_reply_heads(run_id TEXT PRIMARY KEY,draft_id TEXT NOT NULL REFERENCES media_reply_drafts(id),version INTEGER NOT NULL,frozen INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE media_reply_exports(id TEXT PRIMARY KEY,reply_id TEXT NOT NULL UNIQUE,draft_id TEXT NOT NULL REFERENCES media_reply_drafts(id),body TEXT NOT NULL,body_hash TEXT NOT NULL,state TEXT NOT NULL);
    CREATE TRIGGER media_reply_draft_immutable BEFORE UPDATE ON media_reply_drafts BEGIN SELECT RAISE(ABORT,'Immutable media draft');END;
    CREATE TRIGGER media_reply_draft_retain BEFORE DELETE ON media_reply_drafts BEGIN SELECT RAISE(ABORT,'Retain media draft');END;
    CREATE TRIGGER media_reply_export_immutable BEFORE UPDATE OF id,reply_id,draft_id,body,body_hash ON media_reply_exports BEGIN SELECT RAISE(ABORT,'Immutable media export');END;
    CREATE TRIGGER media_reply_export_retain BEFORE DELETE ON media_reply_exports BEGIN SELECT RAISE(ABORT,'Retain media export');END;
    PRAGMA user_version=2;`);
}
export const mediaDraftContentSchema=z.strictObject({schemaVersion:z.literal(1),runId:z.uuid(),scope:ExecutionScopeSchema,taskEpoch:z.number().int().nonnegative(),parts:z.array(z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('asset'),asset:MediaAssetRefSchema,source:MediaSourceDescriptionSchema,as:z.enum(['image','record','file']).optional()}),z.strictObject({kind:z.literal('final-voice'),voiceHash:z.string().length(64).optional()})])).max(8)});
export const mediaDraftSchema=mediaDraftContentSchema.extend({id:z.uuid(),version:z.number().int().positive(),requestId:z.string(),operationId:z.uuid(),authority:MediaReplyAuthoritySchema,createdAt:z.iso.datetime()});
export type MediaDraft=z.infer<typeof mediaDraftSchema>;
const exportSchema=z.strictObject({manifest:ReplyMediaManifestSchema,leases:z.array(z.strictObject({id:z.uuid(),owner:z.string()})).max(8)});
/** Append-only draft revisions and immutable export bodies; guards/byte checks are supplied by the owner. */
export class MediaReplyStore {
  constructor(private readonly db:DatabaseSync,private readonly atomic:<T>(work:()=>T)=>T,private readonly hash:(value:unknown)=>string,private readonly validAsset:(asset:z.infer<typeof MediaAssetRefSchema>)=>void){}
  draft(id:string){const row=this.db.prepare('SELECT body,body_hash FROM media_reply_drafts WHERE id=?').get(z.uuid().parse(id));if(!row)throw new Error('MEDIA_DRAFT_UNAVAILABLE');const body=mediaDraftSchema.parse(JSON.parse(String(row.body)));if(this.hash(body)!==row.body_hash)throw new Error('MEDIA_STATE_CORRUPT');return body;}
  current(runId:string){const row=this.db.prepare('SELECT draft_id,version,frozen FROM media_reply_heads WHERE run_id=?').get(z.uuid().parse(runId));if(!row)return null;const draft=this.draft(String(row.draft_id));if(draft.version!==row.version)throw new Error('MEDIA_STATE_CORRUPT');return {draft,frozen:row.frozen===1};}
  prepare(access:PersonaAccess,input:{requestId:string;expectedVersion:number;content:z.infer<typeof mediaDraftContentSchema>;authority:z.infer<typeof MediaReplyAuthoritySchema>}){return this.atomic(()=>{
    access.guard();const content=mediaDraftContentSchema.parse(input.content);if(content.runId!==access.view.runId||this.hash(content.scope)!==this.hash(access.view.scope)||content.taskEpoch!==access.intentVersion||input.authority.runId!==content.runId||input.authority.operationId!==access.operationId||this.hash(input.authority.scope)!==this.hash(content.scope)||input.authority.intentVersion!==content.taskEpoch)throw new Error('SCOPE_DENIED');
    const previous=this.db.prepare('SELECT id,body FROM media_reply_drafts WHERE run_id=? AND json_extract(body,\'$.requestId\')=?').get(content.runId,input.requestId);
    if(previous){const old=this.draft(String(previous.id));if(this.hash(mediaDraftContentSchema.strip().parse(old))!==this.hash(content)||old.version!==input.expectedVersion+1)throw new Error('IDEMPOTENCY_CONFLICT');return old;}
    const current=this.current(content.runId);if(current?.frozen)throw new Error('MEDIA_DRAFT_FROZEN');if((current?.draft.version??0)!==input.expectedVersion)throw new Error('VERSION_CONFLICT');
    const body=mediaDraftSchema.parse({...content,id:randomUUID(),version:input.expectedVersion+1,requestId:input.requestId,operationId:access.operationId,authority:input.authority,createdAt:new Date().toISOString()});
    this.db.prepare('INSERT INTO media_reply_drafts VALUES(?,?,?,?,?)').run(body.id,body.runId,body.version,JSON.stringify(body),this.hash(body));
    this.db.prepare('INSERT INTO media_reply_heads(run_id,draft_id,version) VALUES(?,?,?) ON CONFLICT(run_id) DO UPDATE SET draft_id=excluded.draft_id,version=excluded.version').run(body.runId,body.id,body.version);access.guard();return body;
  });}
  exported(replyId:string){const row=this.db.prepare('SELECT body,body_hash,state FROM media_reply_exports WHERE reply_id=?').get(replyId);if(!row)return null;const body=exportSchema.parse(JSON.parse(String(row.body)));if(this.hash(body)!==row.body_hash)throw new Error('MEDIA_STATE_CORRUPT');return {...body,state:z.enum(['ready','sent','unknown','blocked']).parse(row.state)};}
  freeze(draft:MediaDraft,manifest:ReplyMediaManifest,leases:z.infer<typeof exportSchema>['leases'],guard:()=>void){return this.atomic(()=>{guard();const current=this.current(draft.runId);if(!current||current.draft.id!==draft.id||this.hash(current.draft)!==this.hash(draft))throw new Error('VERSION_CONFLICT');
    const body=exportSchema.parse({manifest,leases});if(manifest.draft.id!==draft.id||manifest.draft.version!==draft.version||manifest.runId!==draft.runId)throw new Error('MEDIA_EXPORT_BINDING_INVALID');
    if(!draft.parts.length||manifest.parts.length!==draft.parts.length||leases.length!==manifest.parts.length)throw new Error('MEDIA_EXPORT_BINDING_INVALID');
    for(const [index,part] of manifest.parts.entries()){const selected=draft.parts[index]!;
      if(selected.kind==='asset'&&(this.hash(selected.asset)!==this.hash(part.asset)||part.kind!==(selected.as??(selected.asset.kind==='image'?'image':selected.asset.kind==='audio'?'record':'file')))||selected.kind==='final-voice'&&part.kind!=='record')throw new Error('MEDIA_EXPORT_BINDING_INVALID');
      this.validAsset(part.asset);const lease=leases[index]!,actual=this.db.prepare('SELECT * FROM media_leases WHERE id=?').get(lease.id);
      if(!actual||actual.asset_id!==part.asset.id||actual.asset_version!==part.asset.version||actual.owner!==lease.owner||lease.owner!=='media-export:'+manifest.id||actual.released!==0||Number(actual.expires_at)<Date.parse(manifest.expiresAt)||Number(actual.expires_at)<=Date.now())throw new Error('MEDIA_EXPORT_LEASE_REQUIRED');
    }
    const old=this.exported(manifest.replyId);if(old){if(this.hash(old.manifest)!==this.hash(manifest))throw new Error('IDEMPOTENCY_CONFLICT');return old;}
    if(current.frozen)throw new Error('MEDIA_DRAFT_FROZEN');this.db.prepare("INSERT INTO media_reply_exports VALUES(?,?,?,?,?,'ready')").run(manifest.id,manifest.replyId,draft.id,JSON.stringify(body),this.hash(body));
    this.db.prepare('UPDATE media_reply_heads SET frozen=1 WHERE run_id=?').run(draft.runId);guard();return this.exported(manifest.replyId)!;
  });}
  settle(replyId:string,status:'sent'|'unknown'|'blocked'){if(this.db.prepare("UPDATE media_reply_exports SET state=? WHERE reply_id=? AND state='ready'").run(status,replyId).changes!==1&&this.exported(replyId)?.state!==status)throw new Error('MEDIA_EXPORT_STATE_CONFLICT');}
  counts(){return {drafts:Number(this.db.prepare('SELECT count(*) AS n FROM media_reply_drafts').get()?.n),exports:Number(this.db.prepare('SELECT count(*) AS n FROM media_reply_exports').get()?.n)};}
  exports(){return this.db.prepare('SELECT reply_id FROM media_reply_exports ORDER BY rowid').all().map(row=>this.exported(String(row.reply_id))!);}
}
