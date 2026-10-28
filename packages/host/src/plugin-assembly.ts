import { HostConfigSchema } from '@dafeiyu/contracts';
import type { HostConfig } from '@dafeiyu/contracts';
import { z } from 'zod';
import { BiliPluginConfigSchema } from '@dafeiyu/bilibili';
import { BiliOwnerPluginConfigSchema } from '@dafeiyu/bilibili/channel';

/** One platform declaration assembles its transport and capabilities. */
export const BilibiliAssemblySchema=z.strictObject({
  capabilities:BiliPluginConfigSchema.optional(),
  channel:BiliOwnerPluginConfigSchema.optional(),
}).refine(value=>value.capabilities!==undefined||value.channel!==undefined,'Configure a Bilibili interface');

export interface ExpandedHostConfig extends Omit<HostConfig,'plugins'|'paths'> {
  plugins:(Omit<HostConfig['plugins'][number],'id'>&{id:string})[];
  paths:Omit<HostConfig['paths'],'channels'>&{channels:Record<string,string>};
}
export function assembleHostPlugins(raw:unknown):ExpandedHostConfig {
  const config=HostConfigSchema.parse(raw);
  const plugins=config.plugins.flatMap(plugin=>{
    if(plugin.id==='memory-growth')return [{...plugin,id:'memory'}];
    if(plugin.id==='qq')return [{...plugin,id:'channel-qq'}];
    if(plugin.id!=='bilibili')return [plugin];
    const settings=BilibiliAssemblySchema.parse(plugin.config);
    return [
      ...(settings.capabilities?[{...plugin,config:z.record(z.string(),z.json()).parse(settings.capabilities)}]:[]),
      ...(settings.channel?[{...plugin,id:'channel-bili-owner',config:z.record(z.string(),z.json()).parse(settings.channel)}]:[]),
    ];
  });
  const channels:Record<string,string>=config.paths.channels.qq?{'channel-qq':config.paths.channels.qq}:{};
  return {...config,plugins,paths:{...config.paths,channels}};
}
