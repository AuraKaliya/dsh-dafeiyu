#!/usr/bin/env node
const args=process.argv.slice(2);
if(args.length===0||args.length===1&&['--help','-h'].includes(args[0])){
  console.log(JSON.stringify({name:'dafeiyu-server',commands:['inspect --manifest <file>','status --manifest <file>'],runtime:'Program API start/run requires a shared accounting port; no money initialization or top-up commands.'}));
}else{
  try{
    if(!['inspect','status'].includes(args[0])||args.length!==3||args[1]!=='--manifest'||!args[2]||args[2].startsWith('-'))throw new Error('RUNTIME_ARGUMENT_INVALID');
    const {resolve}=await import('node:path'),{loadServerLaunchEnvelope}=await import('../lib/launch-config.js');
    const envelope=loadServerLaunchEnvelope(resolve(args[2]));process.env.DSH_HOME=envelope.home;process.env.DSH_TELEMETRY_DISABLED='1';
    const {parseServerCommand,runServerCommand}=await import('../lib/cli.js');process.exitCode=await runServerCommand(parseServerCommand(args),value=>console.log(JSON.stringify(value)));
  }catch(error){console.log(JSON.stringify({status:'failed',code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'RUNTIME_COMMAND_FAILED'}));process.exitCode=1;}
}
