import React from 'react';
const h = React.createElement;
export function TaskProgressSummary({progress}) {
    if (!progress) return null;
    return h('section', {className:'df-task-progress'},
        h('p', null, '目标：'+progress.labels.goal),
        h('p', null, '执行：'+progress.labels.execution),
        h('p', null, '交付：'+progress.labels.delivery),
        progress.delivery.counts && h('p', null, '结果分段：已确认 '+progress.delivery.counts.confirmed+' / '+progress.delivery.counts.total+'，待发送 '+progress.delivery.counts.pending+'，回执未知 '+progress.delivery.counts.unknown+'。'),
        progress.blocked.reason && h('p', null, progress.blocked.reason),
        progress.next.label && h('p', null, progress.next.label),
        progress.facts.plans.length>0 && h('p', null, '已取得计划配置保存回执；配置保存不代表后台已经执行。'),
        progress.facts.inspection.catalogCalls+progress.facts.inspection.dispatchCalls+progress.facts.inspection.failedCalls>0 && h('p', null,
            '工具目录查询 '+progress.facts.inspection.catalogCalls+' 次，实际宿主工具调用 '+progress.facts.inspection.dispatchCalls+' 次，已取得结果 '+progress.facts.inspection.resultReads+' 页；结果与结论仍需对应。'),
        progress.facts.inspection.failedCommands>0&&h('p',null,'有 '+progress.facts.inspection.failedCommands+' 次命令返回失败，不能据此宣称检查成功。'));
}
function TaskPanel({call,perform,ui:{Button,Detail}}) {
    const [rows,setRows]=React.useState(null),[offset,setOffset]=React.useState(0),[detail,setDetail]=React.useState(null);
    const load=async()=>setRows(await call('list',{offset}));
    const actionLabels={pause:'请求暂停',cancel:'请求取消',resume:'从检查点继续','resume-delivery':'继续结果交付'};
    return h('div',null,
        h(Button,{onClick:()=>perform(load)},'读取任务列表'),
        ...(rows??[]).map(row=>h('article',{key:row.id,className:'df-record'},h('strong',null,row.id),
            row.progress?h(TaskProgressSummary,{progress:row.progress}):h('p',null,'对话执行记录 · '+row.state+' · '+row.updatedAt),
            h(Button,{onClick:()=>perform(async()=>setDetail(await call('detail',{id:row.id})))},'查看详情'))),
        rows?.length===0&&h('p',null,'当前没有任务记录。'),
        h('div',{className:'df-actions'},
            h(Button,{disabled:offset===0,onClick:()=>setOffset(Math.max(0,offset-50))},'上一页'),
            h('span',null,'起始记录 '+(offset+1)+'，点击读取刷新'),
            h(Button,{disabled:(rows?.length??0)<50,onClick:()=>setOffset(offset+50)},'下一页')),
        detail&&h('div',{className:'df-editor'},h('h3',null,'任务详情'),h(TaskProgressSummary,{progress:detail.progress}),
            ...[['概况',detail.run],['执行记录与回执',detail.operations],['业务结果（不代表已核验或送达）',detail.result??'没有可读取的业务结果'],
                ['结果交付',detail.delivery??'尚未创建交付记录'],['自主反思',detail.experience??'没有对应的明确反思记录'],
                ['用量记录',detail.usage??'用量待核实'],['上下文与检查点',detail.status]].map(([title,value])=>h(Detail,{key:title,title,value})),
            h('div',{className:'df-actions'},...(detail.allowedActions??[]).map(action=>h(Button,{key:action,onClick:()=>perform(async()=>{
                await call(action,{id:detail.run.id,expectedVersion:action==='resume-delivery'?detail.delivery.version:detail.run.version,requestId:crypto.randomUUID()});
                setDetail(await call('detail',{id:detail.run.id}));await load();
            })},actionLabels[action]))),h(Button,{onClick:()=>setDetail(null)},'收起详情')));
}
export const managementPanels=[{id:'tasks',component:TaskPanel}];
