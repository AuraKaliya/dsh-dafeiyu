import {existsSync,lstatSync,readdirSync,readFileSync,writeFileSync,mkdirSync,copyFileSync} from 'node:fs';
import {dirname,join,resolve,relative,sep} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';

const repository=resolve(fileURLToPath(new URL('..',import.meta.url)));
const json=file=>JSON.parse(readFileSync(file,'utf8'));
function files(root){if(!existsSync(root))return [];return readdirSync(root,{withFileTypes:true}).flatMap(entry=>{
  const file=join(root,entry.name);if(lstatSync(file).isSymbolicLink())throw new Error('RELEASE_LINK_REFUSED');
  return entry.isDirectory()?files(file):[file];
});}
const portable=path=>path.split(sep).join('/');
function put(root,path,bytes){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});}
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');

/** Produces a fresh allowlisted snapshot. Never reads .runtime, old docs, credentials or Git history. */
export function buildPublicRelease(output,{includeSource=true}={}) {
  const destination=resolve(output),allowed=[join(repository,'.runtime'),process.env.DAFEIYU_TEST_RUN].filter(Boolean);
  if(!allowed.some(root=>{const rest=relative(root,destination);return rest&&!rest.startsWith('..')&&!rest.includes(':');}))throw new Error('RELEASE_OUTPUT_OUTSIDE_WORKSPACE');
  if(existsSync(destination))throw new Error('RELEASE_OUTPUT_EXISTS');mkdirSync(destination,{recursive:true});
  const moduleNames=readdirSync(join(repository,'packages')).filter(name=>existsSync(join(repository,'packages',name,'package.json')));
  const dependencies={},imports={},versions={};
  for(const directory of moduleNames){
    const root=join(repository,'packages',directory),pkg=json(join(root,'package.json'));
    for(const [name,version]of Object.entries({...pkg.peerDependencies,...pkg.dependencies})){
      if(name.startsWith('@dafeiyu/')||name==='dsh-dafeiyu')continue;
      if(dependencies[name]&&dependencies[name]!==version)throw new Error('RELEASE_DEPENDENCY_CONFLICT');dependencies[name]=version;
    }
    if(pkg.name.startsWith('@dafeiyu/')){
      const name=pkg.name.replace('@dafeiyu/','#dafeiyu/');versions[name]=pkg.version;
      for(const [entry,target]of Object.entries(pkg.exports??{'.':pkg.main})){
        const path=typeof target==='string'?target:target.default;
        if(!path?.startsWith('./'))throw new Error('RELEASE_EXPORT_INVALID');
        imports[name+(entry==='.'?'':entry.slice(1))]='./runtime/'+directory+'/'+path.slice(2);
      }
    }
    for(const source of files(join(root,'src')).filter(file=>file.endsWith('.ts'))){
      const stem=portable(relative(join(root,'src'),source)).slice(0,-3);
      for(const extension of ['.js','.d.ts']){
        const built=join(root,'lib',stem+extension);if(!existsSync(built))throw new Error('RELEASE_BUILD_REQUIRED');
        const bytes=readFileSync(built,'utf8').replaceAll('@dafeiyu/','#dafeiyu/').replace(/^\/\/# sourceMappingURL=.*$/gm,'');
        put(destination,'runtime/'+directory+'/lib/'+stem+extension,bytes);
      }
    }
    for(const tree of ['bin','assets','workers','windows','vendor'])for(const file of files(join(root,tree))){
      if(!/\.(?:mjs|cjs|js|ps1|py|md|json|txt)$/i.test(file))throw new Error('RELEASE_ASSET_TYPE_UNEXPECTED');
      const bytes=readFileSync(file,'utf8').replaceAll('@dafeiyu/','#dafeiyu/');put(destination,'runtime/'+directory+'/'+portable(relative(root,file)),bytes);
    }
  }
  const plugin=json(join(repository,'packages/plugin/package.json'));
  const manifest={name:'dsh-dafeiyu',version:plugin.version,type:'module',description:plugin.description,license:'MIT',
    main:'./runtime/plugin/lib/index.js',types:'./runtime/plugin/lib/index.d.ts',
    exports:{'.':{types:'./runtime/plugin/lib/index.d.ts',default:'./runtime/plugin/lib/index.js'},'./settings':'./runtime/plugin/lib/settings.js','./installation':'./runtime/plugin/lib/installation.js'},
    bin:{dafeiyu:'./bin/dafeiyu.mjs'},files:['runtime','bin','examples','docs','cordis.patch.yml','README.md','LICENSE','NOTICE'],
    engines:{node:'>=24.13.0 <25',dsh:'>=0.2.1-rc.2 <0.3.0'},dsh:{bundle:{patch:'./cordis.patch.yml'}},
    repository:{type:'git',url:'https://github.com/AuraKaliya/dsh-dafeiyu.git'},homepage:'https://github.com/AuraKaliya/dsh-dafeiyu#readme',
    keywords:['dsh','deepseek-harness','agent','memory','qq','bilibili'],dependencies,imports,dafeiyuPackages:versions};
  put(destination,'package.json',JSON.stringify(manifest,null,2)+'\n');
  put(destination,'bin/dafeiyu.mjs',"#!/usr/bin/env node\nawait import('../runtime/plugin/bin/dafeiyu.mjs');\n");
  for(const file of ['README.md','LICENSE','NOTICE','cordis.patch.yml'])put(destination,file,readFileSync(join(repository,'packages/plugin',file)));
  for(const tree of ['examples','docs'])for(const file of files(join(repository,'packages/plugin',tree)))put(destination,tree+'/'+portable(relative(join(repository,'packages/plugin',tree),file)),readFileSync(file));
  put(destination,'.gitignore','node_modules/\n.runtime/\n**/node_modules/\n**/.runtime/\n**/build-tests/\nsource/packages/*/lib/\n**/dafeiyu-data/\n*.local.json\n*.token\n*.jsonl\nbilibili.session.json\n.credentials.yaml\n*.tsbuildinfo\n.env*\n*.sqlite*\n*.log\n');
  if(includeSource){
    for(const directory of moduleNames){const root=join(repository,'packages',directory);
      for(const name of ['package.json','tsconfig.json'])put(destination,'source/packages/'+directory+'/'+name,readFileSync(join(root,name)));
      for(const tree of ['src','bin','assets','workers','windows','vendor','examples','docs'])for(const file of files(join(root,tree)))put(destination,'source/packages/'+directory+'/'+portable(relative(root,file)),readFileSync(file));
      for(const name of ['README.md','LICENSE','NOTICE','cordis.patch.yml'])if(existsSync(join(root,name)))put(destination,'source/packages/'+directory+'/'+name,readFileSync(join(root,name)));
    }
    const development=json(join(repository,'package.json'));development.scripts={build:'tsc -b',test:'node scripts/run-tests.mjs','test:cleanup':'node scripts/cleanup-test-runs.mjs','build:release':'npm run build && node scripts/build-public-release.mjs'};
    put(destination,'source/package.json',JSON.stringify(development,null,2)+'\n');
    for(const file of ['package-lock.json','tsconfig.json','tsconfig.base.json','tests/tsconfig.json','scripts/run-tests.mjs','scripts/cleanup-test-runs.mjs','scripts/build-public-release.mjs','scripts/check-public-release.mjs','scripts/build-public-release.d.mts','scripts/check-public-release.d.mts'])put(destination,'source/'+file,readFileSync(join(repository,file)));
    for(const file of files(join(repository,'scripts/testing')))put(destination,'source/'+portable(relative(repository,file)),readFileSync(file));
    const selected=['plugin-startup.test.ts','installation.test.ts','installation-runtime-fixture.ts','plugin-integration.test.ts','bili-owner-production.test.ts','bili-owner-production-fixture.ts','bili-owner-production-lease-child.ts'];
    const visited=new Set();function testFile(path){if(visited.has(path))return;visited.add(path);const bytes=readFileSync(join(repository,'tests',path),'utf8');put(destination,'source/tests/'+path,bytes);
      for(const match of bytes.matchAll(/(?:from\s*|import\()\s*['"](\.\/[^'"]+)['"]/g)){const dependency=portable(join(dirname(path),match[1])).replace(/\.js$/,'.ts');if(existsSync(join(repository,'tests',dependency)))testFile(dependency);}}
    selected.forEach(testFile);put(destination,'source/tests/tooling/README.md','Public smoke suite; full internal acceptance evidence is not distributed.\n');
    for(const name of ['host.test.json','persona.test.md','persona.foundation.md'])put(destination,'source/profiles/'+name,readFileSync(join(repository,'profiles',name)));
  }
  const inventory=files(destination).map(file=>({path:portable(relative(destination,file)),bytes:lstatSync(file).size,sha256:hash(readFileSync(file))}));
  return {directory:destination,version:plugin.version,files:inventory.length,bytes:inventory.reduce((sum,file)=>sum+file.bytes,0),inventory};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  const output=process.argv[2]??join(repository,'.runtime','public-releases',randomUUID());
  const result=buildPublicRelease(output);console.log(JSON.stringify({directory:result.directory,version:result.version,files:result.files,bytes:result.bytes}));
}
