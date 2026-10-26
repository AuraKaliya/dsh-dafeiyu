export declare function physicalPath(path: string): string;
export declare function pathIdentity(path: string): string;
export declare function within(path: string, directory: string): boolean;
export interface HostResource {
    readonly path: string;
    readonly identity: string;
    readonly kind: 'directory' | 'file';
}
export declare function resource(path: string, kind: HostResource['kind']): HostResource;
export declare function overlap(a: HostResource, b: HostResource): boolean;
