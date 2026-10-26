#!/usr/bin/env node
import {readFileSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {physicalPath} from '../lib/paths.js';
const args=process.argv.slice(2);
if(args.length===0||args.length===1&&['--help','-h'].includes(args[0])){
  console.log(JSON.stringify({name:'dafeiyu-host',commands:['inspect --config <file>','init --config <file>','migrate plan --config <file> --backup-dir <dir> --out <file>','migrate apply|verify --config <file> --plan <file>','start --config <file>','run --config <file> --request <file>','status --config <file>'],scope:'local-only'}));
}else{
  try{
    const at=args.indexOf('--config');if(at<0||!args[at+1]||args.lastIndexOf('--config')!==at)throw new Error('HOST_ARGUMENT_INVALID');
    const file=physicalPath(resolve(args[at+1])),bytes=readFileSync(file);if(bytes.length>262144)throw new Error('HOST_CONFIG_INVALID');
    const raw=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));if(typeof raw?.paths?.core!=='string'||!raw.paths.core.trim())throw new Error('HOST_CONFIG_INVALID');
    // This affects this child process only; no desktop DSH profile or credential store is copied.
    process.env.DSH_HOME=join(physicalPath(resolve(dirname(file),raw.paths.core)),'dsh-home');
    const {parseHostCommand,runHostCommand}=await import('../lib/cli.js');
    process.exitCode=await runHostCommand(parseHostCommand(args),value=>console.log(JSON.stringify(value)));
  }catch(error){console.log(JSON.stringify({status:'failed',code:error instanceof Error&&/^[A-Z][A-Z0-9_]{0,99}$/.test(error.message)?error.message:'HOST_COMMAND_FAILED'}));process.exitCode=1;}
}
