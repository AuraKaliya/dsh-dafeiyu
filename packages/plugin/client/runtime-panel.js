import React from 'react';
import {capabilityRows,controlAvailability,errorHint,formatTime,lifecycleLabel,phaseLabel,retryText} from '../lib/management-view.js';
const h = React.createElement;
const instanceLabels = {absent: '没有实例进程', starting: '实例启动中', unconfirmed: '状态待确认', ready: '实例已就绪'};
const dispositionLabels = {accepted: '已受理', completed: '已完成', failed: '失败', rejected: '未受理'};
function Fact({ label, children }) { return h('div', { className: 'df-fact' }, h('dt', null, label), h('dd', null, children ?? '—')); }
/**
 * Pure lifecycle panel: enablement derives from the shared snapshot, never from a
 * local guess. `onControl` receives exactly the action name of the button.
 */
export function RuntimePanel({ snapshot, host = null, busy = false, notice = '', onControl, onRefresh }) {
  const state = snapshot ?? null;
  const availability = controlAvailability(state);
  const rows = capabilityRows(state, host);
  const error = state?.error ?? null;
  const usage=host?.services?.usage,phaseNames={conversation:'对话',task:'任务',media:'媒体理解',review:'复核',rendering:'结果表达',verification:'表达核验',recovery:'恢复',compaction:'上下文整理',feedback:'进度反馈',external:'外部执行',other:'其它'},workNames={conversation:'日常对话','owner-task':'主人任务',patrol:'群巡视',exploration:'自主探索',maintenance:'整理',unassigned:'待归属'};
  return h('section', { className: 'df-section df-runtime', 'data-runtime-state': state?.state ?? 'unknown' },
    h('h2', null, '实例运行'),
    h('p', { className: 'df-muted' }, '启动、停止与重启进入同一个生命周期控制器。状态来自本机快照，查询不会触发模型调用或平台请求。'),
    h('div', { className: 'df-actions df-runtime-controls' },
      h('button', { type: 'button', className: 'df-primary', 'data-action': 'start', disabled: busy || !availability.start, onClick: () => onControl('start') }, '启动实例'),
      h('button', { type: 'button', 'data-action': 'stop', disabled: busy || !availability.stop, onClick: () => onControl('stop') }, '停止实例'),
      h('button', { type: 'button', 'data-action': 'restart', disabled: busy || !availability.restart, onClick: () => onControl('restart') }, '重启并应用配置'),
      h('button', { type: 'button', 'data-action': 'refresh', disabled: busy, onClick: () => onRefresh() }, '刷新运行状态')),
    availability.reason && h('p', { className: 'df-note', 'data-control-reason': availability.reason }, availability.reason),
    notice && h('div', { className: 'df-notice', role: 'status', 'data-runtime-notice': notice }, notice),
    h('dl', { className: 'df-runtime-facts' },
      h(Fact, { label: '生命周期' }, lifecycleLabel(state)),
      h(Fact, { label: '当前阶段' }, state ? phaseLabel(state.phase) : '—'),
      h(Fact, { label: '实例' }, state ? instanceLabels[state.instance] ?? state.instance : '—'),
      h(Fact, { label: '进程 PID' }, state?.pid === null || state?.pid === undefined ? '—' : String(state.pid)),
      h(Fact, { label: '子进程代次' }, state ? String(state.generation) : '—'),
      h(Fact, { label: '当前操作' }, state?.operation ? `${state.operation.action} · ${dispositionLabels[state.operation.disposition] ?? state.operation.disposition} · ${state.operation.id.slice(0, 8)}` : '无'),
      h(Fact, { label: '最近核对' }, formatTime(state?.checkedAt)),
      h(Fact, { label: '下次重试' }, state ? retryText(state.retry) : '—')),
    error && h('div', { className: 'df-notice df-runtime-error', 'data-runtime-error': error.code },
      h('strong', null, '当前错误：' + error.code), h('p', null, errorHint(error.code) ?? '请查看运行阶段与最近核对时间。'), h('p', { className: 'df-muted' }, '记录于 ' + formatTime(error.at))),
    (state?.history?.length ?? 0) > 0 && h('details', { className: 'df-detail', 'data-runtime-history': state.history.length },
      h('summary', null, '历史错误记录（' + state.history.length + '）'),
      h('ul', null, ...state.history.slice(-5).reverse().map((entry, index) => h('li', { key: entry.at + ':' + index }, formatTime(entry.at) + ' · ' + phaseLabel(entry.phase) + ' · ' + entry.code + (errorHint(entry.code) ? '（' + errorHint(entry.code) + '）' : ''))))),
    usage&&h('section',{'data-model-usage':true},h('h3',null,'模型用量'),h('p',{className:'df-muted'},(usage.since?'记录本实例从 '+formatTime(usage.since)+' 起观测的请求。':'启动后尚无模型请求。')+'旧版本漏记的历史没有补造；未知用量不算零。'),
      h('dl',{className:'df-runtime-facts'},h(Fact,{label:'请求次数'},String(usage.calls)),h(Fact,{label:'进行中'},String(usage.pending)),h(Fact,{label:'用量未知'},String(usage.unknownCalls)),h(Fact,{label:'待归属请求'},String(usage.unassignedCalls)),h(Fact,{label:'已知 token'},String(usage.knownTokens)),h(Fact,{label:'非缓存输入'},String(usage.breakdown.inputTokens)),h(Fact,{label:'缓存读取'},String(usage.breakdown.cacheReadTokens)),h(Fact,{label:'缓存写入'},String(usage.breakdown.cacheWriteTokens)),h(Fact,{label:'输出'},String(usage.breakdown.outputTokens))),
      Object.keys(usage.unknownReasons??{}).length>0&&h('p',{className:'df-note'},Object.entries(usage.unknownReasons).map(([reason,count])=>({PROVIDER_USAGE_UNAVAILABLE:'提供方未返回用量',PROVIDER_USAGE_INVALID:'提供方用量数据不一致',PROCESS_INTERRUPTED:'进程中断，未取得结算',EXTERNAL_USAGE_UNAVAILABLE:'外部执行未回报用量'}[reason]??'未知用量')+'：'+count+' 次').join('；')),
      h('h4',null,'按工作类型'),h('ul',null,...Object.entries(usage.byWorkType??{}).map(([type,value])=>h('li',{key:type},(workNames[type]??type)+'：'+value.calls+' 次，已知 '+value.knownTokens+' token，未知 '+value.unknownCalls+' 次'))),
      h('h4',null,'按处理阶段'),h('ul',null,...Object.entries(usage.byPhase).map(([phase,value])=>h('li',{key:phase},(phaseNames[phase]??phase)+'：'+value.calls+' 次，已知 '+value.knownTokens+' token，未知 '+value.unknownCalls+' 次')))),
    h('h3', null, '组件状态'),
    rows.length === 0 ? h('p', { className: 'df-muted' }, '实例尚未报告组件状态。') : h('ul', { className: 'df-runtime-capabilities' }, ...rows.map(row =>
      h('li', { key: row.id, 'data-capability': row.id, 'data-state': row.state }, h('strong', null, row.title), h('span', null, row.state), row.detail && h('span', { className: 'df-muted' }, row.detail)))),
    h('p', { className: 'df-note' }, '实例运行状态与 B站能力分别显示：B站登录或接口受限不等于实例启动失败。'));
}
