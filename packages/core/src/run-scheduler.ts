/** Admission slots shared by foreground conversations and native runs. No call-count cap. */
export class RunScheduler {
  private used=0;
  private readonly queue:{foreground:boolean;resolve:(release:()=>void)=>void}[]=[];
  constructor(private readonly limit:number){}
  acquire(foreground:boolean):Promise<()=>void>{return new Promise(resolve=>{this.queue.push({foreground,resolve});this.pump();});}
  private pump():void{while(this.used<this.limit&&this.queue.length){
    const front=this.queue.findIndex(item=>item.foreground),next=this.queue.splice(front<0?0:front,1)[0]!;this.used++;
    let released=false;next.resolve(()=>{if(released)return;released=true;this.used--;this.pump();});
  }}
  get status(){return {active:this.used,waiting:this.queue.length};}
}
