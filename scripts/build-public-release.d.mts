export interface ReleaseInventory {directory:string;version:string;files:number;bytes:number;inventory:{path:string;bytes:number;sha256:string}[]}
export function buildPublicRelease(output:string,options?:{includeSource?:boolean}):ReleaseInventory;
