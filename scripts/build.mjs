import {existsSync,lstatSync,readdirSync,unlinkSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';

const repository=resolve(dirname(fileURLToPath(import.meta.url)),'..');
function prune(directory,source){
  if(!existsSync(directory))return;
  if(!resolve(directory).startsWith(repository+sep)||lstatSync(directory).isSymbolicLink())throw new Error('INVALID_BUILD_OUTPUT');
  for(const entry of readdirSync(directory,{withFileTypes:true})){
    const target=join(directory,entry.name),sourcePath=join(source,entry.name);
    if(entry.isSymbolicLink())throw new Error('INVALID_BUILD_OUTPUT');
    if(entry.isDirectory()){prune(target,sourcePath);continue;}
    const stem=entry.name.replace(/(?:\.d\.ts(?:\.map)?|\.js(?:\.map)?)$/,'');
    if(stem!==entry.name&&!existsSync(join(source,stem+'.ts')))unlinkSync(target);
  }
}
for(const entry of readdirSync(join(repository,'packages'),{withFileTypes:true}))if(entry.isDirectory())prune(join(repository,'packages',entry.name,'lib'),join(repository,'packages',entry.name,'src'));
prune(join(repository,'build-tests'),join(repository,'tests'));
const child=spawn(process.execPath,[join(repository,'node_modules/typescript/bin/tsc'),'-b',...process.argv.slice(2)],{cwd:repository,windowsHide:true,stdio:'inherit'});
child.on('error',()=>{process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});
