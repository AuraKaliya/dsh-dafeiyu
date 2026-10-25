import type { GenerateOptions } from '@deepseek-ai/dsh-llm';
import { z } from 'zod';
import { evaluationText } from './runtime.ts';
export const HISTORY_BEGIN='EVAL_HISTORY_LINE_BEGIN',HISTORY_END='EVAL_HISTORY_LINE_END';
/** Offline adapter only: extracts from the actual supplied source group, never from answers/criteria. */
export function summarizeActualFixtureSources(options:GenerateOptions,duplicateSameSource=false){const user=options.messages.findLast(m=>m.role==='user'),payload=user?.content.filter(b=>b.type==='text').map(b=>b.text).join('\n')??'',input=z.object({sources:z.array(z.object({seq:z.number(),role:z.string(),text:z.string()}))}).parse(JSON.parse(payload));
  const system=options.messages.filter(m=>m.role==='system').flatMap(m=>m.content.filter(b=>b.type==='text').map(b=>b.text)).join('\n'),budget=Number(/全部text合计最多(\d+)字/.exec(system)?.[1]??400),fragments:{kind:'fact'|'uncertainty';text:string}[]=[];
  for(const source of input.sources){const decoded=source.text.replaceAll('\\n','\n'),pattern=new RegExp(HISTORY_BEGIN+'\\n([\\s\\S]*?)\\n'+HISTORY_END,'g');for(const match of decoded.matchAll(pattern)){const text=`seq ${source.seq}：${match[1]!.trim()}`;if(fragments.some(f=>f.text.endsWith(match[1]!.trim())))continue;const used=Array.from(fragments.map(f=>f.text).join('')).length;
    if(duplicateSameSource&&fragments.length<=14){let repetitions=Math.min(12,Math.floor((budget-used)/(2*(Array.from(text).length+1))));if(repetitions>0){const repeated=Array.from({length:repetitions},()=>text).join(' ');fragments.push({kind:'fact',text:repeated},{kind:'fact',text:repeated});continue;}}
    if(fragments.length<16&&used+Array.from(text).length<=budget)fragments.push({kind:'fact',text});}}
  if(!fragments.length)fragments.push({kind:'uncertainty',text:input.sources.some(s=>s.text.includes(HISTORY_BEGIN))?'片段预算不足以完整保留本组历史，需回查原文。':'本组为控制或确认记录，没有提取到新的标记历史。'});return evaluationText(JSON.stringify({fragments}));}
