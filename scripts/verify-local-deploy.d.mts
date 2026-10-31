export interface LocalDeployFault {code:string;detail?:unknown}
export interface LocalDeployInspection {
  ready:boolean;
  profile:string;
  package:{version:string|null;revision:string|null;stores:{bilibili?:number;runtime?:number}|null}|null;
  checks:{
    profileLink?:string|null;target?:string;configured?:{model:boolean;qqTokenFileConfigured:boolean;bilibiliSession:boolean;bilibiliBrowser:boolean;activity:boolean};
    qqTokenFilePresent?:boolean;dataDir?:string;instance?:{phase:string|null;accepting:boolean;pid:number|null;ageMs:number|null;pidAlive:boolean;bilibiliStore:number|null}|null;
    stores?:{bilibili:number|null;runtime:number|null};
  };
  faults:LocalDeployFault[];
}
export interface LocalDeployOptions {
  profile?:string;settings?:string;data?:string;backup?:string;expectVersion?:string;expectBiliStore?:number;expectRuntimeStore?:number;now?:number|Date;
}
export declare function inspectLocalDeploy(options?:LocalDeployOptions):LocalDeployInspection;
