import type { PendingMessage } from '@dafeiyu/contracts';
/** History scope carries an actual input identity, never a fabricated conversation. */
export interface HistoryFrame {readonly id:string;readonly route:string;readonly sessionId:string;readonly inputKind:'user'|'dafeiyu-execution';readonly inputSourceId:string}
export function conversationHistory(item:PendingMessage):HistoryFrame{return {id:item.id,route:item.route,sessionId:item.sessionId,inputKind:'user',inputSourceId:item.message.id};}
