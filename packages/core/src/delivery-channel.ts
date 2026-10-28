import type {ChannelCapability} from '@dafeiyu/contracts';
export interface DeliveryChannel {identity:object;id:string;version:string;capability:ChannelCapability;signal:AbortSignal}
