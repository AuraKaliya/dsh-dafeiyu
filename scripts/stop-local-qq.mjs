import { writeFile, readFile, access } from 'node:fs/promises';
import { resolve } from 'node:path';
const stage=process.argv[2];if(!['B','C'].includes(stage))throw new Error('Choose stage B or C');
const root=resolve('.runtime/phase2/qq-'+stage);
await access(resolve(root,'status.json'));
await writeFile(resolve(root,'stop.request'),new Date().toISOString());
const deadline=Date.now()+30000;
while(Date.now()<deadline){
  const state=JSON.parse(await readFile(resolve(root,'status.json'),'utf8'));
  if(state.state==='stopped'){console.log(JSON.stringify({stage,stopped:true}));process.exit(0);}
  await new Promise(resolve=>setTimeout(resolve,250));
}
throw new Error('Graceful shutdown did not finish; do not start another account consumer');
