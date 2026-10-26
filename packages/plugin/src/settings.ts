import { readFileSync } from 'node:fs';
import { dirname,resolve } from 'node:path';
import { z } from 'zod';

const path=z.string().trim().min(1).max(4096),uid=z.string().regex(/^[1-9][0-9]{0,19}$/),qq=z.string().regex(/^[1-9][0-9]{4,14}$/);
export const InstallationSettingsSchema=z.strictObject({
  schemaVersion:z.literal(1),dataDir:path,instanceName:z.string().regex(/^[a-z][a-z0-9._-]{0,79}$/).default('dafeiyu'),
  foundationFile:path.optional(),
  model:z.strictObject({model:z.string().trim().min(1).max(160),reasoningEffort:z.string().trim().min(1).max(40).optional(),
    credentialStore:path,baseURL:z.url().optional(),inlineTransport:z.record(z.string(),z.json()).optional()}),
  qq:z.strictObject({botId:qq,ownerId:qq,tokenFile:path,httpURL:z.url(),wsURL:z.url(),
    groupIds:z.array(qq).max(10).default([]),joinedGroups:z.boolean().default(false),naturalNames:z.array(z.string().min(2).max(32)).max(16).default(['大肥鱼']),
    media:z.strictObject({cacheRoots:z.array(path).max(8).default([]),httpsHosts:z.array(z.string()).max(16).default([]),sendEnabled:z.boolean().default(false),voiceDirectives:z.boolean().default(false)}).optional()}).refine(value=>value.botId!==value.ownerId,'Bot and owner must differ'),
  bilibili:z.strictObject({capabilities:z.boolean().default(true),
    session:z.strictObject({file:path,expectedUid:uid}).optional(),
    channel:z.strictObject({accountUid:uid,ownerUid:uid,sessionFile:path}).refine(value=>value.accountUid!==value.ownerUid,'Account and owner must differ').optional()}).optional(),
  media:z.record(z.string(),z.json()).optional(),
  activity:z.strictObject({enabled:z.boolean().default(true),timeZone:z.string().default('Asia/Shanghai'),
    dailyActiveMs:z.number().int().min(100).max(86400000).default(3600000)}).prefault({}),
}).superRefine((value,ctx)=>{
  if(value.bilibili&&!value.bilibili.capabilities&&!value.bilibili.channel)ctx.addIssue({code:'custom',path:['bilibili'],message:'Enable a platform interface or omit the plugin'});
  if(value.qq.media&&!value.media)ctx.addIssue({code:'custom',path:['media'],message:'QQ media interfaces require media configuration'});
  if(value.media?.vision&&!value.model.inlineTransport)ctx.addIssue({code:'custom',path:['model','inlineTransport'],message:'Vision requires explicit image transport configuration'});
  if(value.bilibili?.capabilities&&!value.media)ctx.addIssue({code:'custom',path:['media'],message:'Bilibili video capabilities require media configuration'});
  if(value.bilibili?.session&&value.bilibili.channel&&value.bilibili.session.expectedUid!==value.bilibili.channel.accountUid)ctx.addIssue({code:'custom',path:['bilibili','session','expectedUid'],message:'Platform interfaces must use the same account'});
});
export type InstallationSettings=z.infer<typeof InstallationSettingsSchema>;
export class SettingsError extends Error {
  constructor(readonly fields:readonly string[]){super('INSTALL_CONFIGURATION_REQUIRED');}
}
/** Returns field paths only on failure. Never includes credentials or user values. */
export function readInstallationSettings(file:string):InstallationSettings {
  let raw:unknown;try{const bytes=readFileSync(file);if(bytes.length>262144)throw new Error();raw=JSON.parse(new TextDecoder('utf8',{fatal:true}).decode(bytes));}catch{throw new SettingsError(['settingsFile']);}
  const parsed=InstallationSettingsSchema.safeParse(raw);if(!parsed.success)throw new SettingsError([...new Set(parsed.error.issues.map(issue=>issue.path.join('.')||'settings'))]);
  const settings=parsed.data,base=dirname(resolve(file)),absolute=(value:string)=>resolve(base,value);
  settings.dataDir=absolute(settings.dataDir);settings.model.credentialStore=absolute(settings.model.credentialStore);settings.qq.tokenFile=absolute(settings.qq.tokenFile);
  if(settings.qq.media)settings.qq.media.cacheRoots=settings.qq.media.cacheRoots.map(absolute);
  if(settings.foundationFile)settings.foundationFile=absolute(settings.foundationFile);
  if(settings.bilibili?.session)settings.bilibili.session.file=absolute(settings.bilibili.session.file);
  if(settings.bilibili?.channel)settings.bilibili.channel.sessionFile=absolute(settings.bilibili.channel.sessionFile);
  // Media paths are resolved against this settings file by the profile builder.
  return settings;
}
