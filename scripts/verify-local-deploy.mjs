import {existsSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {join,resolve,isAbsolute,dirname} from 'node:path';
import {homedir} from 'node:os';
import {pathToFileURL} from 'node:url';
import {DatabaseSync} from 'node:sqlite';

const readText=file=>{const bytes=readFileSync(file);const start=bytes[0]===0xEF&&bytes[1]===0xBB&&bytes[2]===0xBF?3:0;return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(start));};
const parseJson=file=>JSON.parse(readText(file));
const kindOf=error=>error instanceof Error?error.message:'UNKNOWN';
const sqliteVersions=file=>{
  if(!existsSync(file))return null;
  const db=new DatabaseSync(file,{readOnly:true});
  try{return {userVersion:Number(db.prepare('PRAGMA user_version').get()?.user_version??0),applicationId:Number(db.prepare('PRAGMA application_id').get()?.application_id??0)};}
  finally{db.close();}
};
const pidAlive=pid=>{try{process.kill(pid,0);return true;}catch(error){return !!error&&error.code==='EPERM';}};
const compareVersion=(left,right)=>{
  const a=left.split('.').map(Number),b=right.split('.').map(Number);
  for(let index=0;index<3;index++){const x=a[index]??0,y=b[index]??0;if(x!==y)return x<y?-1:1;}
  return 0;
};

/**
 * Read-only preflight for a local dafeiyu deployment. It never stops, starts,
 * links or writes anything; every problem is reported as a stable code.
 */
export function inspectLocalDeploy(options={}){
  const profile=options.profile??join(homedir(),'.dsh','profiles','desktop');
  const now=options.now===undefined?Date.now():(typeof options.now==='number'?options.now:new Date(options.now).getTime());
  const faults=[];
  const fault=(code,detail)=>faults.push({code,...(detail===undefined?{}:{detail})});
  const report={ready:false,profile,package:null,checks:{},faults};
  const profileFile=join(profile,'package.json');
  if(!existsSync(profileFile)){fault('PROFILE_MISSING');return report;}
  let manifest;
  try{manifest=parseJson(profileFile);}catch(error){fault('PROFILE_JSON_INVALID',kindOf(error));return report;}
  const specifier=manifest.dependencies?.['dsh-dafeiyu'];
  report.checks.profileLink=typeof specifier==='string'?specifier:null;
  if(typeof specifier!=='string'||!specifier.startsWith('link:')){fault('PROFILE_LINK_MISSING');return report;}
  const raw=specifier.slice(5),target=isAbsolute(raw)?raw:resolve(profile,raw);
  report.checks.target=target;
  if(!existsSync(target)){fault('PACKAGE_MISSING');return report;}
  let pkg;
  try{pkg=parseJson(join(target,'package.json'));}catch(error){fault('PACKAGE_INVALID',kindOf(error));return report;}
  if(pkg.name!=='dsh-dafeiyu')fault('PACKAGE_NAME_INVALID');
  report.package={version:typeof pkg.version==='string'?pkg.version:null,revision:null,stores:null};
  try{
    const release=parseJson(join(target,'release.json'));
    report.package.revision=release.revision??null;
    report.package.stores=release.stores??null;
    if(release.version!==pkg.version)fault('RELEASE_VERSION_MISMATCH',{package:pkg.version,release:release.version});
    if(options.expectVersion&&release.version!==options.expectVersion)fault('VERSION_MISMATCH',{expected:options.expectVersion,actual:release.version});
  }catch(error){fault('RELEASE_MANIFEST_INVALID',kindOf(error));}
  for(const relative of ['client.js','bin/dafeiyu.mjs','cordis.patch.yml','runtime/plugin/lib/index.js'])if(!existsSync(join(target,relative)))fault('PACKAGE_FILE_MISSING',relative);
  try{
    const client=readText(join(target,'client.js'));
    if(!client.includes('df-runtime'))fault('CLIENT_BUNDLE_STALE','lifecycle panel missing');
    if(compareVersion(pkg.version??'0.0.0','0.26.0')>=0&&!client.includes('bilibili-status'))fault('CLIENT_BUNDLE_STALE','verification panel missing');
  }catch{/* a missing client.js is already reported above */}
  const installed=join(profile,'node_modules','dsh-dafeiyu');
  if(!existsSync(installed))fault('PROFILE_INSTALLED_LINK_MISSING');
  else try{
    const installedTarget=realpathSync.native(installed).toLowerCase(),packageTarget=realpathSync.native(target).toLowerCase();
    if(installedTarget!==packageTarget)fault('PROFILE_LINK_TARGET_MISMATCH',{installedTarget,packageTarget});
  }catch(error){fault('PROFILE_LINK_UNREADABLE',kindOf(error));}
  let settingsFile=options.settings??null;
  if(!settingsFile){
    try{
      const match=/settingsFile:\s*(?:'([^']+)'|"([^"]+)"|([^\s#]+))/.exec(readText(join(target,'cordis.patch.yml')));
      if(match)settingsFile=match[1]??match[2]??match[3];
    }catch{/* reported through the package file check */}
  }
  if(!settingsFile)fault('SETTINGS_PATH_MISSING');
  else{
    settingsFile=isAbsolute(settingsFile)?settingsFile:resolve(target,settingsFile);
    if(!existsSync(settingsFile))fault('SETTINGS_MISSING');
    else{
      let settings=null;
      try{settings=parseJson(settingsFile);}catch(error){fault('SETTINGS_INVALID',kindOf(error));}
      if(settings){
        const configured={model:typeof settings.model?.model==='string'&&settings.model.model.length>0,
          qqTokenFileConfigured:typeof settings.qq?.tokenFile==='string'&&settings.qq.tokenFile.length>0,
          bilibiliSession:!!settings.bilibili?.session,bilibiliBrowser:!!settings.bilibili?.browser,activity:settings.activity?.enabled===true};
        report.checks.configured=configured;
        if(configured.qqTokenFileConfigured)report.checks.qqTokenFilePresent=existsSync(isAbsolute(settings.qq.tokenFile)?settings.qq.tokenFile:resolve(dirname(settingsFile),settings.qq.tokenFile));
        const dataDir=options.data??(typeof settings.dataDir==='string'?(isAbsolute(settings.dataDir)?settings.dataDir:resolve(dirname(settingsFile),settings.dataDir)):null);
        if(!dataDir)fault('DATA_DIR_UNRESOLVED');
        else{
          report.checks.dataDir=dataDir;
          const core=join(dataDir,'core'),statusFile=join(core,'host-status.json');
          if(existsSync(statusFile)){
            try{
              const status=parseJson(statusFile),age=now-Date.parse(status.at);
              report.checks.instance={phase:status.phase??null,accepting:status.accepting===true,pid:typeof status.pid==='number'?status.pid:null,
                ageMs:Number.isFinite(age)?age:null,pidAlive:typeof status.pid==='number'&&pidAlive(status.pid),bilibiliStore:status.schemas?.bilibili??null};
            }catch(error){fault('HOST_STATUS_INVALID',kindOf(error));}
          }else report.checks.instance=null;
          const bili=sqliteVersions(join(core,'bilibili.sqlite'));
          report.checks.stores={bilibili:bili?bili.userVersion:null,runtime:sqliteVersions(join(core,'runtime.sqlite'))?.userVersion??null};
          if(!bili)fault('BILIBILI_STORE_MISSING');
          else{
            if(bili.applicationId!==0x44464236)fault('BILIBILI_APPLICATION_MISMATCH',bili.applicationId);
            if(options.expectBiliStore!==undefined&&bili.userVersion!==options.expectBiliStore)fault('BILIBILI_STORE_MISMATCH',{expected:options.expectBiliStore,actual:bili.userVersion});
            if(options.expectRuntimeStore!==undefined){
              const runtime=report.checks.stores.runtime;
              if(runtime!==options.expectRuntimeStore)fault('RUNTIME_STORE_MISMATCH',{expected:options.expectRuntimeStore,actual:runtime??null});
            }
          }
        }
      }
    }
  }
  if(options.backup){
    if(!existsSync(options.backup))fault('BACKUP_MISSING',options.backup);
    else try{if(!statSync(options.backup).isDirectory())fault('BACKUP_NOT_DIRECTORY',options.backup);}catch(error){fault('BACKUP_MISSING',kindOf(error));}
  }
  report.ready=faults.length===0;
  return report;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const flags=new Map();
  for(let at=2;at<process.argv.length;at++){
    const key=process.argv[at];if(!key.startsWith('--'))throw new Error('usage: node scripts/verify-local-deploy.mjs [--profile <dir>] [--settings <file>] [--data <dir>] [--expect-version <v>] [--expect-bilibili <n>] [--expect-runtime <n>] [--backup <dir>]');
    flags.set(key.slice(2),process.argv[++at]);
  }
  const number=key=>flags.has(key)?Number(flags.get(key)):undefined;
  const result=inspectLocalDeploy({...(flags.has('profile')?{profile:flags.get('profile')}:{}),...(flags.has('settings')?{settings:flags.get('settings')}:{}),...(flags.has('data')?{data:flags.get('data')}:{}),
    ...(flags.has('expect-version')?{expectVersion:flags.get('expect-version')}:{}),...(flags.has('expect-bilibili')?{expectBiliStore:number('expect-bilibili')}:{}),
    ...(flags.has('expect-runtime')?{expectRuntimeStore:number('expect-runtime')}:{}),...(flags.has('backup')?{backup:flags.get('backup')}:{})});
  console.log(JSON.stringify(result,null,2));
  if(!result.ready)process.exitCode=1;
}
