const MAX_TEXT = 32000;
const MAX_PART = 800;
const MAX_PARTS = 64;
function split(text:string,maxParts:number):string[] {
  if (!text || text.length>MAX_TEXT) throw new Error('TEXT_SIZE_UNSUPPORTED');
  for (const char of text) {const code=char.codePointAt(0)!;if(code>=0xd800&&code<=0xdfff)throw new Error('INVALID_TEXT_ENCODING');}
  const parts:string[]=[];
  let start=0;
  while(start<text.length){
    let end=Math.min(start+MAX_PART,text.length);
    // Reserve enough space for the remainder even for thousands of tiny sentences.
    const fits=(boundary:number)=>Math.ceil((text.length-boundary)/(MAX_PART-1))<=maxParts-parts.length-1;
    if(end<text.length){
      const newline=text.lastIndexOf('\n',end-1);
      if(newline>=start+600&&fits(newline+1))end=newline+1;
    }
    if(end<text.length){
      if(text.charCodeAt(end-1)>=0xd800&&text.charCodeAt(end-1)<=0xdbff)end--;
      if(text[end-1]==='\r'&&text[end]==='\n')end--;
    }
    parts.push(text.slice(start,end));start=end;
  }
  return parts;
}

/** Lossless transport partition: Unicode/CRLF safe and no more than 64 messages. */
export function splitQqText(text:string):string[]{return split(text,MAX_PARTS);}

export function splitQqMessages(messages:readonly string[],_structured:boolean):string[][] {
  const parts:string[][]=[];
  let remaining=MAX_PARTS;
  for(let index=0;index<messages.length;index++){
    const reserve=messages.slice(index+1).reduce((sum,text)=>sum+Math.ceil(text.length/(MAX_PART-1)),0);
    const current=split(messages[index]!,remaining-reserve);
    parts.push(current);remaining-=current.length;
  }
  return parts;
}
