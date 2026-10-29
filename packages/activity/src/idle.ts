import type {Context} from '@deepseek-ai/cordis';
import type {DatabaseSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {ExecutionLifecycle} from '@dafeiyu/contracts';
import type {ActivityStore} from './store.js';
import {quietAt} from './time.js';
const idleSchema=z.strictObject({id:z.uuid(),request:z.strictObject({requestId:z.uuid(),title:z.string(),goal:z.string(),policyId:z.literal('activity-explore')}),runs:z.array(z.uuid()),activeSince:z.number().nullable(),elapsedMs:z.number().nonnegative(),paused:z.boolean(),settled:z.boolean()});
export function createIdleSchema(db:DatabaseSync){db.exec('CREATE TABLE activity_idle_work(id TEXT PRIMARY KEY,body TEXT NOT NULL);');}
export class IdleWorkStore {
  constructor(private readonly db:DatabaseSync){}
  pending(){return this.db.prepare("SELECT body FROM activity_idle_work WHERE json_extract(body,'$.settled')=0 ORDER BY rowid LIMIT 1").all().map(row=>idleSchema.parse(JSON.parse(String(row.body))))[0]??null;}
  save(value:z.infer<typeof idleSchema>){const body=idleSchema.parse(value);this.db.prepare('INSERT INTO activity_idle_work VALUES(?,?) ON CONFLICT(id) DO UPDATE SET body=excluded.body').run(body.id,JSON.stringify(body));}
  owns(runId:string){return this.db.prepare("SELECT 1 FROM activity_idle_work w,json_each(w.body,'$.runs') r WHERE r.value=? AND json_extract(w.body,'$.settled')=0").get(runId)!==undefined;}
}
/** Owner-enabled idle work uses the ordinary DSH task path and its explicit activity policy. */
export class IdleActivity {
  private readonly port;
  constructor(private readonly ctx:Context,private readonly store:ActivityStore){this.port=ctx.dafeiyu.executionProducer('activity',{motivation:{kind:'self-exploration',basis:['owner-enabled-idle-activity']}});}
  receive(event:ExecutionLifecycle){if(event.type!=='run.running'||event.origin.kind!=='continuation')return;const work=this.store.idle.pending();if(!work||!work.runs.includes(event.origin.parentRunId)||work.runs.includes(event.runId))return;work.runs.push(event.runId);work.activeSince=Date.parse(event.at);work.paused=false;this.store.idle.save(work);}
  control(now:number,foreground:boolean){const work=this.store.idle.pending();if(!work)return false;
    const runId=work.runs.at(-1);if(!this.store.config.exploration&&!runId){this.finish(work,now,true);return false;}if(!runId){if(foreground)return true;const accepted=this.port.submitTask(work.request);work.runs.push(accepted.run.id);work.activeSince=now;this.store.idle.save(work);return true;}
    const ref=this.port.restoreRun(runId),status=this.port.status(ref);
    if(status.state==='running'&&foreground&&!work.paused){work.paused=true;this.store.idle.save(work);this.port.pause(ref,{requestId:'idle-pause:'+runId,expectedVersion:status.version,reason:'前台交互优先'});return true;}
    if(status.state==='waiting'&&status.error===null&&!work.paused){if(work.activeSince!==null){work.elapsedMs+=Math.max(0,now-work.activeSince);work.activeSince=null;this.store.idle.save(work);}return true;}
    if(status.state==='waiting'&&work.paused){if(work.activeSince!==null){work.elapsedMs+=Math.max(0,now-work.activeSince);work.activeSince=null;this.store.idle.save(work);}if(foreground)return true;
      const checkpoint=status.checkpoints.at(-1);if(!checkpoint){this.finish(work,now,true);return false;}const task=this.port.openTask(status.taskId!),state=this.port.taskState(task);
      const resumed=this.port.resume(task,{requestId:'idle-resume:'+runId,taskId:task.id,expectedVersion:state.version,policyId:'activity-explore',parentRunId:runId,checkpointId:checkpoint});work.runs.push(resumed.run.id);work.activeSince=now;work.paused=false;this.store.idle.save(work);return true;}
    if(['completed','failed','cancelled','interrupted','waiting'].includes(status.state)){this.finish(work,now,status.state!=='completed');return false;}
    return true;
  }
  private finish(work:z.infer<typeof idleSchema>,now:number,stop:boolean){if(work.activeSince!==null)work.elapsedMs+=Math.max(0,now-work.activeSince);work.activeSince=null;
    const usage=work.runs.map(id=>this.ctx.dafeiyu.managementUsage(id)),knownTokens=usage.reduce((sum,item)=>sum+item.knownTokens,0);
    this.store.rounds.settle('idle:'+work.id,{tokens:usage.length&&usage.every(item=>item.tokens!==null)?knownTokens:null,knownTokens},work.elapsedMs,now);work.settled=true;this.store.idle.save(work);if(stop)this.store.rounds.end('activity-stopped',now);
  }
  start(now:number){if(this.store.idle.pending()||!this.store.config.exploration||!this.store.rounds.canStart(now)||quietAt(now,this.store.config.timeZone,this.store.config.quiet))return false;
    const id=randomUUID(),work=idleSchema.parse({id,request:{requestId:id,title:'空闲时的一次自主活动',goal:'现在满足主人设置的空闲条件。结合自己的记忆与可用能力，选择并完成一次有意义的活动；可以整理记忆、使用允许的能力探索，也可以选择休息。不要把这个触发当作主人交办的具体任务，不构造对外消息来源。活动结束时留下自己的看法；想休息时调用 dafeiyu_activity_rest。每项活动完成后程序才检查本轮经费和时间。',policyId:'activity-explore'},runs:[],activeSince:null,elapsedMs:0,paused:false,settled:false});
    this.store.admitIdle(work,now);return true;
  }
}
