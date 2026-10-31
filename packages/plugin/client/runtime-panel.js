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
    h('h3', null, '组件状态'),
    rows.length === 0 ? h('p', { className: 'df-muted' }, '实例尚未报告组件状态。') : h('ul', { className: 'df-runtime-capabilities' }, ...rows.map(row =>
      h('li', { key: row.id, 'data-capability': row.id, 'data-state': row.state }, h('strong', null, row.title), h('span', null, row.state), row.detail && h('span', { className: 'df-muted' }, row.detail)))),
    h('p', { className: 'df-note' }, '实例运行状态与 B站能力分别显示：B站登录或接口受限不等于实例启动失败。'));
}
