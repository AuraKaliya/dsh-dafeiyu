import React from 'react';
const h = React.createElement;
function ActivityPanel({ call, perform, ui: { Button, Detail } }) {
    const [value, setValue] = React.useState(null);
    const load = async () => setValue(await call('status', null));
    return h('div', null, h(Button, { onClick: () => perform(load) }, '读取轮次与计划'), value && h(React.Fragment, null, h('h4', null, '最近活动轮次'), ...(value.rounds ?? []).map(round => h('article', { key: round.id, className: 'df-record' }, h('strong', null, round.endedAt === null ? '进行中的轮次' : '已结束的轮次'), h('p', null, `已完成 ${round.completed} 项 · ${(round.knownTokens / 10000).toFixed(3)} 万 Token${round.unknown ? '（另有用量待核实）' : ''} · ${(round.durationMs / 60000).toFixed(2)} 分钟`), h(Detail, { title: '预算快照与结束原因', value: round }))), h('h4', null, '已有计划'), ...(value.plans ?? []).map(plan => h('article', { key: plan.body.id, className: 'df-record' }, h('strong', null, plan.body.goal), h('p', { className: 'df-muted' }, `${plan.status} · ${plan.body.purpose}`), h(Detail, { title: '触发条件与授权依据', value: plan }), h('div', { className: 'df-actions' }, ...['paused', 'active', 'cancelled'].map(state => h(Button, { key: state, disabled: plan.body.state === 'cancelled' || plan.body.state === state, onClick: () => perform(async () => { await call('plan.update', { id: plan.body.id, requestId: crypto.randomUUID(), expectedVersion: plan.body.version, state }); await load(); }) }, ({ paused: '暂停后续执行', active: '恢复计划', cancelled: '取消计划' })[state])))))));
}
export const managementPanels = [{ id: 'activity', component: ActivityPanel }];
