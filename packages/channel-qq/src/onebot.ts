import { z } from 'zod';

/** No remote OneBot endpoints or credential-bearing URLs in this local development connector. */
export function loopbackURL(value: string, protocol: 'http:' | 'ws:'): string {
  const url = new URL(value);
  if (url.protocol !== protocol || !['127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Expected a plain loopback endpoint');
  return url.href;
}
export const platformId = z.union([z.string().regex(/^-?\d+$/), z.number().int().safe()]).transform(String);
const responseSchema = z.object({ status: z.string(), retcode: z.number(), data: z.unknown() });
export class OneBot {
  constructor(private readonly base: string, private readonly token: string, readonly botId: string, private readonly timeoutMs: number) {}
  async call(action: 'get_login_info' | 'get_status' | 'send_private_msg' | 'send_group_msg', params: object, signal?: AbortSignal): Promise<unknown> {
    const timeout = AbortSignal.timeout(this.timeoutMs);
    const response = await fetch(new URL(action, this.base), { method: 'POST', redirect: 'error',
      headers: { Authorization: 'Bearer ' + this.token, 'Content-Type': 'application/json' }, body: JSON.stringify(params),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout });
    if (!response.ok) throw new Error('ONEBOT_HTTP_FAILURE');
    const body = responseSchema.parse(await response.json());
    if (body.status !== 'ok' || body.retcode !== 0) throw new Error('ONEBOT_REJECTED_OR_UNKNOWN');
    return body.data;
  }
  async verify(signal?: AbortSignal): Promise<void> {
    const info = z.object({ user_id: platformId }).parse(await this.call('get_login_info', {}, signal));
    if (info.user_id !== this.botId) throw new Error('ACCOUNT_MISMATCH');
    const status = z.object({ online: z.boolean() }).parse(await this.call('get_status', {}, signal));
    if (!status.online) throw new Error('QQ_OFFLINE');
  }
}
