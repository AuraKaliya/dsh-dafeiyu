import type {ManagementRuntimeSnapshot,ModelUsageOverview} from '@dafeiyu/contracts';
export declare function InputContextSummary(props:{value:ModelUsageOverview['inputContext']}):unknown;
export interface RuntimePanelProps {
  readonly snapshot:ManagementRuntimeSnapshot|null;
  readonly host?:unknown;
  readonly busy?:boolean;
  readonly notice?:string;
  readonly onControl:(action:'start'|'stop'|'restart')=>void;
  readonly onRefresh:()=>void;
}
/** React element; typed as unknown because this repository does not ship React type packages. */
export declare function RuntimePanel(props:RuntimePanelProps):unknown;
