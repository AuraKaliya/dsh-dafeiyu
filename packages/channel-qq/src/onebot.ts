import { z } from 'zod';
import { parseSnowLumaGroups, SNOWLUMA_GROUP_LIST_REQUEST } from './snowluma-groups.js';

/** No remote OneBot endpoints or credential-bearing URLs in this local development connector. */
export function loopbackURL(value: string, protocol: 'http:' | 'ws:'): string {
  const url = new URL(value);
  if (url.protocol !== protocol || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a plain loopback endpoint');
  return url.href;
}
export const platformId = z.union([z.string().regex(/^-?\d+$/), z.number().int().safe()]).transform(String);
const responseSchema = z.object({ status: z.string(), retcode: z.number(), data: z.unknown() });
type OneBotAction = 'get_login_info' | 'get_status' | 'get_group_list' | 'get_image' | 'get_record' | 'get_file' | 'send_private_msg' | 'send_group_msg';
export class OneBot {
  constructor(private readonly base: string, private readonly token: string, readonly botId: string, private readonly timeoutMs: number) {}
  call(action: OneBotAction, params: object, signal?: AbortSignal): Promise<unknown> { return this.request(action, params, signal); }
  private async request(action: OneBotAction | 'send_packet', params: object, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(new URL(action, this.base), { method: 'POST', redirect: 'error',
      // Local processing can outlast an idle socket's server timeout. Avoid reusing that socket;
      // never repair an ambiguous send by automatically issuing the POST again.
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json',Connection:'close' }, body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error('ONEBOT_HTTP_FAILURE');
    const reader=response.body?.getReader();if(!reader)throw new Error('ONEBOT_INVALID_RESPONSE');const chunks:Uint8Array[]=[];let bytes=0;
    try{while(true){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>2*1024**2){await reader.cancel();throw new Error('ONEBOT_RESPONSE_LIMIT');}chunks.push(part.value);}}
    finally{reader.releaseLock();}
    let raw:unknown;try{raw=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new Error('ONEBOT_INVALID_RESPONSE');}
    const body = responseSchema.parse(raw);
    if (body.status !== 'ok' || body.retcode !== 0) throw new Error('ONEBOT_REJECTED_OR_UNKNOWN');
    return body.data;
  }
  async verify(signal?: AbortSignal): Promise<void> {
    const info = z.object({ user_id: platformId }).parse(await this.call('get_login_info', {}, signal));
    if (info.user_id !== this.botId) throw new Error('ACCOUNT_MISMATCH');
    const status = z.object({ online: z.boolean() }).parse(await this.call('get_status', {}, signal));
    if (!status.online) throw new Error('QQ_OFFLINE');
  }
  async groups(signal: AbortSignal) {
    await this.verify(signal);
    let response: unknown;
    try { response = await this.request('send_packet', SNOWLUMA_GROUP_LIST_REQUEST, signal); }
    catch (error) { signal.throwIfAborted(); throw new Error('GROUP_SETTINGS_UNAVAILABLE'); }
    const list = parseSnowLumaGroups(response);
    await this.verify(signal);
    return list;
  }
}
