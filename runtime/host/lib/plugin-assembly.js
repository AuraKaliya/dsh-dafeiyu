import { HostConfigSchema } from '#dafeiyu/contracts';
import { z } from 'zod';
import { BiliPluginConfigSchema } from '#dafeiyu/bilibili';
import { BiliOwnerPluginConfigSchema } from '#dafeiyu/bilibili/channel';
/** Public configuration groups a platform's channel and capabilities together.
 * Internal extension IDs remain stable so historical source and delivery keys survive. */
export const BilibiliAssemblySchema = z.strictObject({
    capabilities: BiliPluginConfigSchema.optional(),
    channel: BiliOwnerPluginConfigSchema.optional(),
}).refine(value => value.capabilities !== undefined || value.channel !== undefined, 'Configure a Bilibili interface');
export function normalizeHostPlugins(raw) {
    const config = HostConfigSchema.parse(raw);
    const plugins = config.plugins.flatMap(plugin => {
        if (plugin.id === 'memory-growth')
            return [{ ...plugin, id: 'memory' }];
        if (plugin.id === 'qq')
            return [{ ...plugin, id: 'channel-qq' }];
        if (plugin.id !== 'bilibili' || !('capabilities' in plugin.config || 'channel' in plugin.config))
            return [plugin];
        const settings = BilibiliAssemblySchema.parse(plugin.config);
        return [
            ...(settings.capabilities ? [{ ...plugin, config: z.record(z.string(), z.json()).parse(settings.capabilities) }] : []),
            ...(settings.channel ? [{ ...plugin, id: 'channel-bili-owner', config: z.record(z.string(), z.json()).parse(settings.channel) }] : []),
        ];
    });
    const channels = { ...config.paths.channels };
    if (channels.qq) {
        if (channels['channel-qq'])
            throw new Error('HOST_DUPLICATE_CHANNEL_STORAGE');
        channels['channel-qq'] = channels.qq;
        delete channels.qq;
    }
    return HostConfigSchema.parse({ ...config, plugins, paths: { ...config.paths, channels } });
}
