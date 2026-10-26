import {readdirSync,lstatSync,readFileSync} from 'node:fs';
import {join,resolve,relative,sep} from 'node:path';
import {pathToFileURL} from 'node:url';

/** Local denylist values are supplied by the reviewer; findings never repeat their content. */
export function inspectPublicRelease(root,{forbiddenValues=[]}={}){
  const findings=[];let files=0,bytes=0;
  const visit=directory=>{for(const name of readdirSync(directory)){if(name==='.git'||name==='node_modules')continue;const file=join(directory,name),info=lstatSync(file),path=relative(root,file).split(sep).join('/');
    if(info.isSymbolicLink()){findings.push({path,code:'LINK'});continue;}if(info.isDirectory()){if(['.runtime','检查记录','大肥鱼人格提示词'].includes(name))findings.push({path,code:'PRIVATE_DIRECTORY'});else visit(file);continue;}
    files++;bytes+=info.size;
    if(/(?:^|\/)(?:\.env(?:\..*)?|credentials?[^/]*|[^/]*\.sqlite(?:-.*)?|[^/]*\.log)$/.test(path))findings.push({path,code:'PRIVATE_FILE'});
    const text=readFileSync(file,'utf8');
    if(forbiddenValues.some(value=>value.length>=6&&text.includes(value)))findings.push({path,code:'PRIVATE_LOCAL_VALUE'});
    if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\b(?:ghp|github_pat)_[A-Za-z0-9_]{20,}|\bsk-[A-Za-z0-9_-]{24,}/.test(text))findings.push({path,code:'CREDENTIAL_PATTERN'});
    if(path.startsWith('runtime/')&&text.includes('@dafeiyu/'))findings.push({path,code:'PRIVATE_PACKAGE_DEPENDENCY'});
  }};visit(root);
  const manifest=JSON.parse(readFileSync(join(root,'package.json'),'utf8')),example=JSON.parse(readFileSync(join(root,'examples/dafeiyu.config.json'),'utf8'));
  if(Object.keys(manifest.dependencies??{}).some(name=>name.startsWith('@dafeiyu/')))findings.push({path:'package.json',code:'PRIVATE_PACKAGE_DEPENDENCY'});
  for(const key of ['botId','ownerId','tokenFile'])if(example.qq?.[key]!=='')findings.push({path:'examples/dafeiyu.config.json',code:'IDENTITY_DEFAULT'});
  if(example.model?.credentialStore!==''||example.model?.model!=='')findings.push({path:'examples/dafeiyu.config.json',code:'MODEL_DEFAULT'});
  return {passed:findings.length===0,files,bytes,findings};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){const result=inspectPublicRelease(resolve(process.argv[2]));console.log(JSON.stringify(result));if(!result.passed)process.exitCode=1;}
