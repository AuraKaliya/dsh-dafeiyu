import type { Context } from '@deepseek-ai/cordis';
import { credentialKey } from '@deepseek-ai/dsh-credentials';
import Authorization from '@deepseek-ai/dsh-authorization';
import PlatformAccount from '@deepseek-ai/dsh-deepseek-account-platform';
import * as AccountModel from '@deepseek-ai/dsh-llm-deepseek-account';
import { z } from 'zod';
import { installInlineDeepSeek } from './inline-model.js';
import type { InlineModelSettings } from './inline-model.js';

/** Reuses the official account service. No token is converted to an API key or copied to another store. */
export async function installAccountModel(ctx:Context,input:{baseURL:string;route:{provider:string;model:string;reasoningEffort?:string|undefined};inlineTransport?:InlineModelSettings;guard:()=>void}):Promise<void>{
  if(new URL(input.baseURL).origin!=='https://api.deepseek.com')throw new Error('HOST_ACCOUNT_ORIGIN_INVALID');
  const record=await ctx.credentials.readRecord(credentialKey('deepseek-account-platform','default'));
  if(!record)throw new Error('HOST_ACCOUNT_SIGN_IN_REQUIRED');
  // The official service removes grants from a different deployment on initialization. Refuse before that write.
  if(record.kind!=='grant'||!z.object({version:z.literal(1),issuer:z.literal('https://platform.deepseek.com')}).safeParse(record.payload).success)throw new Error('HOST_ACCOUNT_RECORD_UNSUPPORTED');
  if(!ctx.get('authorization'))await ctx.plugin(Authorization);
  await ctx.plugin(PlatformAccount,{desktopPlatform:process.platform==='win32'?'win32':process.platform==='darwin'?'darwin':null});
  if((await ctx.deepseekAccount.getState()).status!=='credential-stored')throw new Error('HOST_ACCOUNT_SIGN_IN_REQUIRED');
  if(input.inlineTransport)await installInlineDeepSeek(ctx,{auth:'dsh-account',baseURL:input.baseURL,credentialName:'DEEPSEEK_API_KEY',route:input.route,settings:input.inlineTransport,credentialGuard:input.guard});
  else await ctx.plugin(AccountModel,{baseURL:input.baseURL});
}
