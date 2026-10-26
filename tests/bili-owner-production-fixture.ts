import {BILI_OWNER_ACCOUNT,BILI_OWNER_UID} from './bili-owner-identity.js';
import { mkdtemp,mkdir,readFile,writeFile } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { biliOwnerTextHash } from '@dafeiyu/bilibili/channel';
import { BILI_OWNER_AUTH_HASH,BiliOwnerProductionManifestSchema } from '../packages/bilibili/lib/channel/production-config.js';
import type { BiliOwnerProductionConfig } from '../packages/bilibili/lib/channel/production-config.js';
import { testTempDir } from './test-temp.js';

export const NAV='https://api.bilibili.com/x/web-interface/nav',READ='https://api.vc.bilibili.com/svr_sync/v1/svr_sync/fetch_session_msgs',SEND='https://api.vc.bilibili.com/web_im/v1/web_im/send_msg';
export const noNetwork:typeof globalThis.fetch=async()=>{throw new Error('UNEXPECTED_DEFAULT_NETWORK');};
export const nav=(uid=BILI_OWNER_ACCOUNT)=>({code:0,data:{isLogin:true,mid:uid,uname:'FICTIONAL_ACCOUNT',wbi_img:{img_url:'https://i0.hdslb.com/bfs/wbi/1234567890abcdef1234567890abcdef.png',sub_url:'https://i0.hdslb.com/bfs/wbi/fedcba0987654321fedcba0987654321.png'}}});
export const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json'}});
/** Copies only the publicly audited source file. Credentials below are invented in this managed test directory. */
export async function productionFixture(){const root=await mkdtemp(join(testTempDir(),'bili-owner-production-')),configuration=join(root,'配置文件'),publicPath=join(configuration,'bilibili.json'),credentialPath=join(configuration,'凭据','bilibili.session.json'),manifestPath=join(configuration,'bili-owner-channel.json');
  await mkdir(join(configuration,'凭据'),{recursive:true});
  const publicValue={accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,enabled:true,privateMessages:{autoReply:true,pollMs:30000}};await writeFile(publicPath,JSON.stringify(publicValue));
  const credentials=(account=BILI_OWNER_ACCOUNT,token='FICTIONAL_SESSION')=>writeFile(credentialPath,JSON.stringify({mid:account,cookies:{DedeUserID:account,SESSDATA:token,bili_jct:'FICTIONAL_CSRF'},createdAt:'2026-10-27T00:00:00.000Z'}));await credentials();
  let manifest=BiliOwnerProductionManifestSchema.parse({schemaVersion:1,kind:'bili-owner-channel',enabled:true,accountUid:BILI_OWNER_ACCOUNT,ownerUid:BILI_OWNER_UID,generation:7,authModuleHash:BILI_OWNER_AUTH_HASH,publicConfigHash:biliOwnerTextHash(JSON.stringify(publicValue))}),config:BiliOwnerProductionConfig;
  const repin=async(generation=manifest.generation)=>{manifest={...manifest,generation,publicConfigHash:biliOwnerTextHash(await readFile(publicPath,'utf8'))};const bytes=JSON.stringify(manifest);await writeFile(manifestPath,bytes);config={installationRoot:root,manifestPath,manifestHash:biliOwnerTextHash(bytes)};return config;};await repin();
  return {root,publicPath,credentialPath,manifestPath,get config(){return config;},get manifest(){return manifest;},credentials,repin};
}
