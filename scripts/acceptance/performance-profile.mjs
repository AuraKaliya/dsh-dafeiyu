import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';

/** Sampling time is inclusive for stacks; overlapping parent totals must not be added. */
export function summarizeCpuProfile(profile,fromMs=0,toMs=Infinity){
  const nodes=new Map(profile.nodes.map(node=>[node.id,node])),parents=new Map();
  for(const node of profile.nodes)for(const child of node.children??[])parents.set(child,node.id);
  const label=node=>{const frame=node.callFrame,url=frame.url.replaceAll('\\','/'),match=url.match(/\/(packages|runtime|node_modules)\/(.*)$/);
    return {fn:frame.functionName||'(anonymous)',file:match?match[1]+'/'+match[2]:url.startsWith('node:')?url:url.split('/').at(-1),line:frame.lineNumber+1};};
  const self=new Map(),inclusive=new Map();let elapsed=0,total=0;
  const add=(map,id,us)=>{const frame=label(nodes.get(id)),key=JSON.stringify(frame),row=map.get(key)??{...frame,us:0};row.us+=us;map.set(key,row);};
  for(let index=0;index<profile.samples.length;index++){
    const start=elapsed;elapsed+=profile.timeDeltas[index]??0;const us=Math.max(0,Math.min(elapsed,toMs*1000)-Math.max(start,fromMs*1000));if(!us)continue;total+=us;
    let id=profile.samples[index];if(!nodes.has(id))throw new Error('CPU_SAMPLE_NODE_MISSING');add(self,id,us);const visited=new Set(),frames=new Set();
    while(id!==undefined){if(visited.has(id))throw new Error('CPU_SAMPLE_CYCLE');visited.add(id);const key=JSON.stringify(label(nodes.get(id)));if(!frames.has(key)){add(inclusive,id,us);frames.add(key);}id=parents.get(id);}
  }
  const top=rows=>[...rows.values()].sort((a,b)=>b.us-a.us).slice(0,24).map(({us,...row})=>({...row,ms:Math.round(us/1000)}));
  return {fromMs,toMs:Number.isFinite(toMs)?toMs:null,sampledMs:Math.round(total/1000),self:top(self),inclusive:top(inclusive)};
}
if(process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url){
  const bytes=readFileSync(process.argv[2]);console.log(JSON.stringify({sha256:createHash('sha256').update(bytes).digest('hex'),...summarizeCpuProfile(JSON.parse(bytes.toString('utf8')),Number(process.argv[3]??0),process.argv[4]===undefined?Infinity:Number(process.argv[4]))},null,2));
}
