export interface OfflineArguments {workspace:string;cases:string[];all:boolean;retry:boolean;recover:boolean;report:boolean}
export function parseOfflineArguments(args:string[]):OfflineArguments{
  const result:OfflineArguments={workspace:'',cases:[],all:false,retry:false,recover:false,report:false},seen=new Set<string>();
  for(let index=0;index<args.length;index++){
    const argument=args[index]!;
    if(argument==='--workspace'||argument==='--case'){
      const value=args[++index];if(!value||value.startsWith('--'))throw new Error('EVALUATION_ARGUMENT_INVALID');
      if(argument==='--workspace'){if(result.workspace)throw new Error('EVALUATION_ARGUMENT_INVALID');result.workspace=value;}else result.cases.push(value);
    }else if(['--all','--retry','--recover','--report'].includes(argument)){
      if(seen.has(argument))throw new Error('EVALUATION_ARGUMENT_INVALID');seen.add(argument);
      if(argument==='--all')result.all=true;else if(argument==='--retry')result.retry=true;else if(argument==='--recover')result.recover=true;else result.report=true;
    }else throw new Error('EVALUATION_ARGUMENT_INVALID');
  }
  if(!result.workspace||result.all&&result.cases.length||result.retry&&!result.all&&!result.cases.length||!result.all&&!result.cases.length&&!result.report&&!result.recover)throw new Error('EVALUATION_ARGUMENT_INVALID');
  return result;
}
