import { managementPanels as taskPanels } from '../../core/client/management.js';
import { managementPanels as memoryPanels } from '../../memory/client/management.js';
import { managementPanels as stickerPanels } from '../../channel-qq/client/management.js';
import { managementPanels as activityPanels } from '../../activity/client/management.js';
import React from 'react';
const h = React.createElement;
const tabs = [['overview', '总览'], ['personality', '人格与记忆'], ['capabilities', '能力'], ['tasks', '任务与记录'], ['prompts', '提示词预览'], ['runtime', '运行']];
const stateLabels = { running: '运行中', starting: '启动中', stopped: '已停止', stopping: '正在停止', failed: '启动或运行失败' };
const pretty = value => JSON.stringify(value, null, 2);
function Detail({ title, value }) { return h('details', { className: 'df-detail' }, h('summary', null, title), h('pre', null, typeof value === 'string' ? value : pretty(value))); }
function Button({ onClick, children, disabled = false, primary = false }) { return h('button', { type: 'button', onClick, disabled, className: primary ? 'df-primary' : '' }, children); }
const panelRegistry = new Map([...taskPanels, ...memoryPanels, ...stickerPanels, ...activityPanels].map(panel => [panel.id, panel.component]));
function RemotePanel({ module, panel, call, perform }) { const [value, setValue] = React.useState(null), Component = panelRegistry.get(panel); if (Component)
    return h(Component, { call: (action, input) => call(module, action, input), perform, ui: { Button, Detail } }); return h('div', null, h(Button, { onClick: () => perform(async () => setValue(await call(module, 'status', null))) }, '读取当前状态'), module === 'qq' && h(Button, { onClick: () => perform(async () => setValue(await call(module, 'connection.check', null))) }, '检查组件连通'), value ? h(Detail, { title: '当前模块状态', value }) : h('p', { className: 'df-muted' }, '未连接实例时不显示示例状态。')); }
function Field({ field, value, onChange }) {
    const scale = field.scale ?? 1;
    const displayed = value == null ? '' : field.kind === 'json' ? pretty(value) : field.kind === 'lines' ? (value ?? []).join('\n') : field.kind === 'number' ? value / scale : value;
    let input;
    if(field.kind==='choices')input=h('div',{className:'df-field-group'},...(field.options??[]).map(option=>h('label',{key:option.value},h('input',{type:'checkbox',checked:(value??[]).includes(option.value),onChange:e=>onChange(e.target.checked?[...(value??[]),option.value]:(value??[]).filter(item=>item!==option.value))}),option.label)));
    else if(field.kind==='select')input=h('select',{value:value??'',onChange:e=>onChange(e.target.value||null)},h('option',{value:''},'使用默认值'),...(field.options??[]).map(option=>h('option',{key:option.value,value:option.value},option.label)));
    else if(field.kind==='time-windows')input=h('div',null,...(value??[]).map((window,index)=>h('div',{key:index,className:'df-actions'},h('input',{type:'time',value:window.start,'aria-label':'开始时间 '+(index+1),onChange:e=>onChange(value.map((entry,i)=>i===index?{...entry,start:e.target.value}:entry))}),h('span',null,'至'),h('input',{type:'time',value:window.end,'aria-label':'结束时间 '+(index+1),onChange:e=>onChange(value.map((entry,i)=>i===index?{...entry,end:e.target.value}:entry))}),h(Button,{onClick:()=>onChange(value.filter((_entry,i)=>i!==index))},'删除时段'))),h(Button,{disabled:(value?.length??0)>=8,onClick:()=>onChange([...(value??[]),{start:'22:00',end:'08:00'}])},'添加安静时段'));
    else if(field.kind==='numbers')input=h('textarea',{rows:3,value:(value??[]).map(item=>item/scale).join('\n'),onChange:e=>onChange(e.target.value.split('\n').map(item=>item.trim()).filter(Boolean).map(item=>Number(item)*scale))});
    else if (field.kind === 'boolean')
        input = h('input', { type: 'checkbox', checked: !!value, onChange: e => onChange(e.target.checked) });
    else if (field.kind === 'json' || field.kind === 'lines')
        input = h('textarea', { rows: field.kind === 'json' ? 5 : 3, value: displayed, onChange: e => onChange(field.kind === 'lines' ? e.target.value.split('\n').map(s => s.trim()).filter(Boolean) : { draftJson: e.target.value }) });
    else
        input = h('input', { type: field.kind === 'number' ? 'number' : 'text', value: displayed, min: field.minimum, max: field.maximum, step: 'any', onChange: e => onChange(e.target.value === '' ? null : field.kind === 'number' ? Number(e.target.value) * scale : e.target.value) });
    if (value && typeof value === 'object' && 'draftJson' in value)
        input = h('textarea', { rows: 5, value: value.draftJson, onChange: e => onChange({ draftJson: e.target.value }) });
    return h(['choices','time-windows'].includes(field.kind)?'div':'label', { className: 'df-field' }, h('span', null, field.label, field.unit && h('small', null, ' · ' + field.unit)), input, h('small', null, field.description));
}
function Module({ module, configuration, drafts, changeDraft, call, perform, save }) {
    const draft = drafts[module.id] ?? {};
    return h('div', null, h('h2', null, module.title), h('p', { className: 'df-lead' }, module.description), ...module.sections.map(section => h('section', { key: section.id, id: `df-${module.id}-${section.id}`, className: 'df-section' }, h('h3', null, section.title), h('p', { className: 'df-muted' }, section.description), ...section.fields.map(field => h(Field, { key: field.path, field, value: Object.hasOwn(draft, field.path) ? draft[field.path] : configuration?.values?.[field.path], onChange: value => changeDraft(module.id, field.path, value) })), section.id === 'delay' && h('p', { className: 'df-note' }, '示例：按默认规则，50 字回复等待 3 秒；500 字达到 10 秒上限。'), section.optionalPath && h(Button, {onClick:()=>changeDraft(module.id,section.optionalPath,null)}, '移除此项组件配置'), section.panel && h(RemotePanel, { module: module.id, panel: section.panel, call, perform }))), module.sections.some(section => section.fields.length) && h('div', { className: 'df-save' }, h('span', null, Object.keys(draft).length ? `${Object.keys(draft).length} 个未保存字段` : '配置与文件一致'), h(Button, { disabled: !configuration?.revision || !Object.values(drafts).some(value => Object.keys(value).length), onClick: () => perform(() => save(module.id)), primary: true }, '保存全部配置草稿')));
}
export function createManagementApp(request) {
    return function ManagementApp() {
        const [view, setView] = React.useState(null), [tab, setTab] = React.useState('overview'), [selected, setSelected] = React.useState(null), [busy, setBusy] = React.useState(false), [notice, setNotice] = React.useState(''), [drafts, setDrafts] = React.useState({}), [foundation, setFoundation] = React.useState(null);
        const invoke = async (body) => { const result = await request(body); if (!result.ok)
            throw new Error(result.code + (result.fields?.length ? '：' + result.fields.join('、') : '')); return result.value; };
        const refresh = async () => setView(await invoke({ kind: 'describe' }));
        const perform = async (work) => { if (busy)
            return; setBusy(true); setNotice(''); try {
            await work();
        }
        catch (error) {
            setNotice(error.message);
        }
        finally {
            setBusy(false);
        } };
        React.useEffect(() => { void perform(refresh); }, []);
        const call = (module, action, input) => invoke({ kind: 'module', module, action, input });
        const navigate = (target, module = null) => { setTab(target); setSelected(module); };
        const save = async () => { const changes = []; for (const [module, draft] of Object.entries(drafts)) {
            const values = {};
            for (const [key, value] of Object.entries(draft))
                values[key] = value && typeof value === 'object' && 'draftJson' in value ? (value.draftJson.trim() ? JSON.parse(value.draftJson) : null) : value;
            if (Object.keys(values).length)
                changes.push({ module, values });
        } const saved = await invoke({ kind: 'save', revision: view.configuration.revision, changes }); setDrafts(current=>Object.fromEntries(Object.entries(current).map(([module,fields])=>[module,Object.fromEntries(Object.entries(fields).filter(([key,value])=>JSON.stringify(value)!==JSON.stringify(drafts[module]?.[key])))]))); await refresh(); setNotice(saved.notice ?? (saved.applies === 'next-round' ? '预算已保存；当前轮保持原预算，下一轮应用新预算。' : '已保存。当前运行不变，下次启动使用新配置。')); };
        const modules = view?.modules ?? [], active = modules.find(module => module.id === selected), status = view?.runtime?.state ?? 'loading';
        return h('main', { className: 'df-app', 'aria-busy': busy }, h('header', { className: 'df-header' }, h('div', null, h('p', { className: 'df-eyebrow' }, 'DAFEIYU · 管理'), h('h1', null, '大肥鱼管理中心'), h('p', null, '查看她的成长，管理她使用的能力。')), h('span', { className: 'df-badge' }, stateLabels[status] ?? '正在读取')), h('nav', { className: 'df-tabs', 'aria-label': '管理中心页面' }, ...tabs.map(([id, label]) => h('button', { key: id, type: 'button', 'aria-current': tab === id ? 'page' : undefined, onClick: () => navigate(id) }, label))), notice && h('div', { className: 'df-notice', role: 'status' }, notice), busy && h('p', { role: 'status' }, '正在处理…'), view?.configuration?.error && h('div', { className: 'df-notice' }, '配置尚未就绪：请在插件设置中指定配置文件，然后填写下列模块缺失的字段；所有草稿会一起保存。', h('p', null, (view.configuration.fields ?? []).join('、'))), tab === 'overview' && h('div', null, h('section', { className: 'df-section' }, h('h2', null, '陪伴与成长'), h('p', null, '人格来自记忆。能力提供接口和使用流程，经历与自己的看法分别留存。'), h('div', { className: 'df-actions' }, h(Button, { onClick: () => navigate('personality', 'memory') }, '查看人格与记忆'), h(Button, { onClick: () => navigate('prompts') }, '查看提示词组装'))), h('h2', null, '模块管理'), h('div', { className: 'df-cards' }, ...modules.filter(m => m.id !== 'tasks').map(module => h('button', { key: module.id, className: 'df-card', onClick: () => navigate(module.tab, module.id) }, h('strong', null, module.title), h('span', null, module.description)))), h('p', { className: 'df-muted' }, `程序版本 ${view?.version ?? '…'} · API ${view?.apiVersion ?? '…'} · 运行状态以实例返回为准`)), ['capabilities', 'runtime', 'personality'].includes(tab) && h(React.Fragment, null, h('div', { className: 'df-module-tabs' }, ...modules.filter(m => m.tab === tab && m.id !== 'tasks').map(module => h(Button, { key: module.id, onClick: () => setSelected(module.id), primary: active?.id === module.id }, module.title))), active && active.tab === tab ? h(Module, { module: active, configuration: view.configuration, drafts, changeDraft: (id, key, value) => setDrafts(old => ({ ...old, [id]: { ...old[id], [key]: value } })), call, perform, save }) : h('p', { className: 'df-muted' }, '选择一个模块查看详细设置。'), tab === 'runtime' && h('div', { className: 'df-actions' }, ...['start', 'stop', 'restart'].map(action => h(Button, { key: action, disabled: busy, onClick: () => perform(async () => { await invoke({ kind: 'runtime', action }); await refresh(); }) }, ({ start: '启动实例', stop: '停止实例', restart: '重启并应用配置' })[action])), h(Button, { onClick: () => perform(refresh) }, '刷新运行状态'))), tab === 'tasks' && h('section', { className: 'df-section' }, h('h2', null, '任务与记录'), h('p', { className: 'df-muted' }, '查看概况、执行回执、结果、用量和上下文；未知效果不会通过继续按钮自动重演。'), h(RemotePanel, { module: 'tasks', panel: 'tasks', call, perform })), tab === 'prompts' && h('div', null, h('h2', null, '提示词文本预览'), h('p', { className: 'df-lead' }, '稳定规则与底色构成前缀。合法历史保留，新状态以完整快照追加；最后一份快照代表当前状态。'), h('p', { className: 'df-note' }, '颜色与来源标签只用于界面。预览不调用模型，不读取会话原文，也不执行上下文 prepare。'), h(Button, { onClick: () => perform(async () => { const value = await call('memory', 'status', null); setFoundation(value.foundation); }) }, '读取已保存的身份底色'), ...['system', 'context', 'history', 'tools'].map(position => h('section', { key: position, className: 'df-section' }, h('h3', null, ({ system: '稳定系统提示词', context: '本轮上下文增量', history: '有效历史', tools: '工具定义（独立字段）' })[position]), ...[...(view?.prompts ?? []), ...modules.flatMap(m => m.prompts), { id: 'history', module: 'tasks', title: '会话、工具回执与有效历史', position: 'history', dynamic: true, condition: '按真实会话与来源范围读取' }].filter(p => p.position === position).sort((a,b)=>(a.id==='foundation'?-1:0)-(b.id==='foundation'?-1:0)).map(prompt => h('details', { key: prompt.id, className: `df-prompt df-source-${prompt.module}`, open: !!prompt.dynamic }, h('summary', null, prompt.title), h('button', { className: 'df-source-link', onClick: () => { const owner = modules.find(m => m.id === prompt.module); navigate(owner?.tab ?? 'runtime', owner?.id ?? 'runtime'); } }, '来源：' + (modules.find(m => m.id === prompt.module)?.title ?? prompt.module)), h('p', { className: 'df-muted' }, prompt.condition), h('pre', null, prompt.dynamic ? '【动态提示词】' : prompt.id === 'foundation' ? (foundation?.text ?? '请连接实例并读取已保存的底色。') : prompt.text ?? '未提供静态正文'), prompt.source && h('small', null, prompt.source)))))), h('footer', { className: 'df-footer' }, h('span', null, '配置与实际运行分开呈现'), h(Button, { disabled: busy, onClick: () => perform(refresh) }, '刷新管理中心')));
    };
}
