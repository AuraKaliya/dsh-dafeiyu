export interface FileDigest {path:string;bytes:number;sha256:string}
export function fileHash(file:string):string;
export function fileInventory(root:string,options?:{payload?:boolean}):FileDigest[];
export function inventoryHash(inventory:readonly FileDigest[]):string;
export function inspectReleaseIntegrity(root:string):{version:string;release:{version:string;revision:string|null;contentHash:string;sourceHash?:string;driverHash?:string;buildRuntimeHash?:string;stores:Record<string,number>};contentHash:string;files:number;bytes:number};
export function inspectInstalledDependencies(root:string):{lockHash:string;contentHash:string;files:number;dependencies:{name:string;specifier:string;version:string;path:string;entry:string}[]};
