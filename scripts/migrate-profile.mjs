import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { HostConfigSchema } from '@dafeiyu/contracts';
import { runtimeHash } from '@dafeiyu/core/runtime-store';
import { planMigration, applyMigration, verifyMigration, MigrationPlanSchema } from '@dafeiyu/host';

const mode=process.argv[2],args=process.argv.slice(3),options={};
for(let index=0;index<args.length;index+=2){const name=args[index],value=args[index+1];if(!['--config','--backup-dir','--out','--plan'].includes(name)||!value||Object.hasOwn(options,name))throw new Error('INVALID_MIGRATION_ARGUMENT');options[name]=value;}
try{
  if(mode==='plan'){
    if(!options['--config']||!options['--backup-dir']||!options['--out'])throw new Error('PLAN_REQUIRES_CONFIG_BACKUP_AND_OUTPUT');
    const configFile=resolve(options['--config']),base=dirname(configFile),config=HostConfigSchema.parse(JSON.parse(await readFile(configFile,'utf8')));
    if(Object.keys(config.paths.channels).some(id=>id!=='channel-qq'))throw new Error('UNSUPPORTED_CHANNEL_STORAGE');
    let sourceRevision='unavailable',dirty=true;
    try{sourceRevision=execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();dirty=!!execFileSync('git',['status','--porcelain'],{encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim();}catch{/* Package installs may not have Git metadata. */}
    const plan=await planMigration({coreDir:resolve(base,config.paths.core),memoryDir:resolve(base,config.paths.memory),sessionsDir:resolve(base,config.paths.sessions),backupDir:resolve(options['--backup-dir']),
      identity:{agentId:config.agent.id,profileId:config.profileId},qqFiles:Object.values(config.paths.channels).map(directory=>join(resolve(base,directory),'qq.sqlite')),
      provenance:{sourceRevision,dirty,configHash:runtimeHash(config)}});
    const out=resolve(options['--out']);await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
    console.log(JSON.stringify({status:'planned',plan:out,id:plan.id,stores:plan.files.map(file=>({kind:file.kind,from:file.before.version,to:file.targetVersion,exists:file.before.exists}))}));
  }else if(mode==='apply'||mode==='verify'){
    if(!options['--plan'])throw new Error('PLAN_FILE_REQUIRED');
    const plan=MigrationPlanSchema.parse(JSON.parse(await readFile(resolve(options['--plan']),'utf8')));
    if(mode==='apply'){
      if(!options['--config'])throw new Error('APPLY_REQUIRES_CONFIG');
      const config=HostConfigSchema.parse(JSON.parse(await readFile(resolve(options['--config']),'utf8')));
      if(!plan.bundle.provenance||runtimeHash(config)!==plan.bundle.provenance.configHash)throw new Error('MIGRATION_CONFIG_CHANGED');
      console.log(JSON.stringify(await applyMigration(plan)));
    }else{const result=verifyMigration(plan);console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}
  }else throw new Error('UNKNOWN_MIGRATION_MODE');
}catch(error){console.log(JSON.stringify({status:'failed',code:typeof error?.message==='string'&&/^[A-Z0-9_]+$/.test(error.message)?error.message:'MIGRATION_FAILED'}));process.exitCode=1;}
