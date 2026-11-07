import React from 'react';
const h = React.createElement;
function ActivityPanel({ call, perform, ui: { Button, Detail } }) {
    const [value, setValue] = React.useState(null);
    const load = async () => setValue(await call('status', null));
    const recovery = value?.recovery, gate = recovery?.gate;
    React.useEffect(() => { if (!recovery?.probing) return; const timer = setInterval(() => perform(load), 3000); return () => clearInterval(timer); }, [recovery?.probing]);
    const recoveryPanel = recovery && h('section', null,
        h('h4', null, '模型恢复与旧探索续办'),
        h('p', null, gate && gate.reason !== 'restored' ? '模型依赖暂停。账户类错误等待修复后验证；瞬时错误按退避进行有限探测。' : '没有待验证的模型暂停。恢复后的旧探索会在允许活动时沿原任务续办。'),
        gate && gate.reason !== 'restored' && h(Button, { disabled: recovery.probing, onClick: () => perform(async () => { await call('recovery.probe', { requestId: crypto.randomUUID(), expectedGeneration: gate.generation }); await load(); }) }, recovery.probing ? '正在验证' : '验证模型恢复一次'),
        h(Detail, { title: '恢复探测回执', value: recovery.probes }),
        h(Detail, { title: '旧探索续办与待处理原因', value: recovery.work }));
    const planCards = (value?.plans ?? []).map(plan => h('article', { key: plan.body.id, className: 'df-record' },
        h('strong', null, plan.body.goal), h('p', { className: 'df-muted' }, `${plan.status} · ${plan.body.purpose}`),
        plan.dispatch?.note && h('p', null, plan.dispatch.note),
        h(Detail, { title: '触发条件与授权依据', value: plan }),
        h('div', { className: 'df-actions' }, ...['paused', 'active', 'cancelled'].map(state => h(Button, { key: state,
            disabled: plan.body.state === 'cancelled' || plan.body.state === state,
            onClick: () => perform(async () => { await call('plan.update', { id: plan.body.id, requestId: crypto.randomUUID(), expectedVersion: plan.body.version, state }); await load(); })
        }, ({ paused: '暂停后续执行', active: '恢复计划', cancelled: '取消计划' })[state])))));
    return h('div', null, h(Button, { onClick: () => perform(load) }, '读取轮次与计划'), value && h(React.Fragment, null, recoveryPanel, h('h4', null, '最近活动轮次'), ...(value.rounds ?? []).map(round => h('article', { key: round.id, className: 'df-record' }, h('strong', null, round.endedAt === null ? '进行中的轮次' : '已结束的轮次'), h('p', null, `已完成 ${round.completed} 项 · ${(round.knownTokens / 10000).toFixed(3)} 万 Token${round.unknown ? '（另有用量待核实）' : ''} · ${(round.durationMs / 60000).toFixed(2)} 分钟`), h(Detail, { title: '用量记录与结束原因', value: round }))), h(Detail,{title:'暂停与休息状态',value:value.admission}),h(Detail,{title:'探索候选记录',value:value.explorations}),h('h4', null, '已有计划'), ...planCards));
}
export const managementPanels = [{ id: 'activity', component: ActivityPanel }];
