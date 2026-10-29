import { createManagementApp } from './app.js';
import css from './style.css';
import { managementRemote } from '../lib/management-remote.js';
// The shared descriptor contains only protocol metadata; Host services never enter this bundle.
export const inject = ['slots', 'remote'];
export async function apply(ctx) {
    const unmount = await ctx.remote.$mount(managementRemote);
    ctx.effect(() => unmount);
    const request = async (body) => { const result = await ctx.remote.dafeiyuManagement.request(JSON.stringify(body)); if (!result.ok)
        throw new Error(result.error.code); return JSON.parse(result.value); };
    const App = createManagementApp(body => request({ apiVersion: API_VERSION, ...body }));
    ctx.effect(() => { const style = document.createElement('style'); style.textContent = css; document.head.append(style); return () => style.remove(); });
    ctx.slots.inject('settings.section', () => ctx.slots.register({ name: 'settings.section', id: 'dafeiyu', order: 80, label: () => '大肥鱼管理中心' }, App));
}
