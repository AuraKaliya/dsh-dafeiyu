import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
const file=process.argv[2]!;const raw=JSON.parse(readFileSync(file,'utf8'));process.env.DSH_HOME=resolve(dirname(file),raw.paths.core,'dsh-home');
const {parseHostCommand,runHostCommand}=await import('../packages/host/lib/cli.js');
let ready=false;const code=await runHostCommand(parseHostCommand(['start','--config',file]),value=>{console.log(JSON.stringify(value));
  if(!ready&&value&&typeof value==='object'&&'phase'in value&&value.phase==='ready'){ready=true;setTimeout(()=>process.emit('SIGINT'),80);}});
process.exitCode=code;
