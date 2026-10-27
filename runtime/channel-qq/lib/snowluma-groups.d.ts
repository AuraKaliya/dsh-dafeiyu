import type { GroupInfo } from './groups.js';
/** The verified read-only joined-group query. No caller-supplied command or payload. */
export declare const SNOWLUMA_GROUP_LIST_REQUEST: Readonly<{
    cmd: "OidbSvcTrpcTcp.0xfe5_2";
    data: "08e51f1002220e0a0c0a06180120012801120238016001";
    rsp: true;
}>;
/** Missing/unknown mask values retain membership but cannot grant group access. */
export declare function parseSnowLumaGroups(raw: unknown): GroupInfo[];
