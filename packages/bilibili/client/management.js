import React from 'react';
const h = React.createElement;
const engineLabels = { unverified: '尚未验证', verifying: '正在验证', verified: '登录有效', expired: '登录已失效', mismatch: '账号不符', interrupted: '验证中断' };
const credentialLabels = { 'not-configured': '未配置凭据文件', invalid: '凭据文件无效', ready: '凭据可读取' };
const stateLabels = { pending: '进行中', completed: '已完成', failed: '失败', interrupted: '已中断' };
const scopeLabels = { 'anonymous-http': '匿名 HTTP', 'verified-http': '已登录 HTTP', browser: '浏览器', resource: '媒体/字幕资源', shared: '共享或来源不明' };
const routeLabels = { available: '可用', cooldown: '等待冷却', 'diagnostic-required': '需要诊断' };
const codeLabels = { BILI_SESSION_NOT_CONFIGURED: '尚未配置本地凭据文件', BILI_SESSION_INVALID: '凭据文件格式或 UID 校验失败', BILI_ACCOUNT_MISMATCH: '服务端登录 UID 与配置不符', BILI_LOGIN_REQUIRED: '登录态已失效，需要更新本地凭据文件', BILI_BACKOFF: '仍在冷却等待', BILI_DIAGNOSTIC_REQUIRED: '共享或来源不明的暂停阻止了自动探测', BILI_SESSION_CHANGED: '凭据在验证过程中变化，旧结果未采用', BILI_VERIFICATION_CANCELLED: '验证已取消', BILI_VERIFICATION_INTERRUPTED: '实例重启中断了上次验证' };
const hint = code => code ? codeLabels[code] ?? code : '';
/**
 * Owner-only verification panel. Credentials stay in the local file: there is no cookie
 * input, and login validity is displayed separately from interface availability.
 */
export function BilibiliStatusPanel({ call, ui }) {
  const Button = ui.Button, Detail = ui.Detail;
  const [status, setStatus] = React.useState(null), [notice, setNotice] = React.useState(''), [busy, setBusy] = React.useState(false);
  const [target, setTarget] = React.useState({ endpoint: 'video', bvid: '', aid: '', keyword: '', page: 1, limit: 5 });
  const sequence = React.useRef(0);
  const read = async () => { const token = ++sequence.current; const value = await call('verify.status', {}); if (token === sequence.current) setStatus(value); return value; };
  React.useEffect(() => { void read().catch(error => setNotice(error.message)); }, []);
  React.useEffect(() => {
    if (!status?.active)
      return;
    let cancelled = false, timer = null, inFlight = false;
    const tick = async () => { if (cancelled || inFlight)
      return; if (typeof document !== 'undefined' && document.visibilityState === 'hidden')
      return; inFlight = true; try {
      await read();
    }
    catch (error) {
      if (!cancelled)
        setNotice(error.message);
    }
    finally {
      inFlight = false; if (!cancelled)
        timer = setTimeout(tick, 1000);
    } };
    timer = setTimeout(tick, 1000);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [status?.active?.id]);
  const run = async (action, input) => { if (busy)
      return; setBusy(true); setNotice(''); try {
      const result = await call(action, input);
      if (result?.accepted === false)
        setNotice('操作未受理：' + (result.code ?? '未知原因'));
      else if (result?.reused)
        setNotice('已有验证正在进行，复用同一操作。');
      else
        setNotice('已受理：' + String(result?.operationId ?? '').slice(0, 8) + '；页面每秒查询进度。');
      await read();
  }
  catch (error) {
      setNotice(error.message);
  }
  finally {
      setBusy(false);
  } };
  const testRead = () => {
    const endpoint = target.endpoint;
    const input = endpoint === 'video' ? { endpoint, bvid: target.bvid.trim() } : endpoint === 'comments' ? { endpoint, aid: target.aid.trim(), page: Number(target.page), limit: Number(target.limit) } : endpoint === 'search' ? { endpoint, keyword: target.keyword.trim(), page: Number(target.page), limit: Number(target.limit) } : { endpoint, page: Number(target.page), limit: Number(target.limit) };
    return run('verify.read', input);
  };
  const account = status?.account, http = status?.http, operations = status?.operations ?? [];
  return h('div', { className: 'df-bili-status', 'data-bili-account': account?.engine ?? 'unknown' },
    h('div', { className: 'df-actions' },
      h(Button, { disabled: busy, onClick: () => run('verify.start', {}), primary: true }, '验证登录'),
      h(Button, { disabled: busy, onClick: testRead }, '测试读取'),
      h(Button, { disabled: busy || !status?.active, onClick: () => run('verify.cancel', {}) }, '取消验证'),
      h(Button, { disabled: busy, onClick: () => { setNotice(''); void read().catch(error => setNotice(error.message)); } }, '刷新账号状态')),
    notice && h('div', { className: 'df-notice', role: 'status', 'data-bili-notice': notice }, notice),
    h('h3', null, '账号与凭据'),
    account ? h('dl', { className: 'df-runtime-facts' },
      h('div', null, h('dt', null, '本地凭据'), h('dd', null, credentialLabels[account.credentialState] ?? account.credentialState)),
      h('div', null, h('dt', null, '配置账号'), h('dd', null, account.expectedUid ?? '—')),
      h('div', null, h('dt', null, '登录状态'), h('dd', { 'data-bili-engine': account.engine }, engineLabels[account.engine] ?? account.engine)),
      h('div', null, h('dt', null, '已验证 UID'), h('dd', null, account.verifiedUid ?? '—')),
      h('div', null, h('dt', null, '验证时间'), h('dd', null, account.verifiedAt ? new Date(account.verifiedAt).toLocaleString('zh-CN', { hour12: false }) : '—')),
      h('div', null, h('dt', null, '有效至'), h('dd', null, account.expiresAt ? new Date(account.expiresAt).toLocaleTimeString('zh-CN', { hour12: false }) : '—')))
      : h('p', { className: 'df-muted' }, '正在读取账号状态。'),
    h('p', { className: 'df-note' }, 'Cookie 只存放在实例外的本地凭据文件中，通过文件路径引用；管理中心不提供 Cookie 输入框，聊天中也不会提交凭据。'),
    h('h3', null, '读取能力'),
    http ? h('ul', { className: 'df-runtime-capabilities' },
      h('li', { 'data-route': 'http' }, h('strong', null, 'HTTP 读取'), h('span', null, (http.identity === 'anonymous' ? '匿名' : '已登录') + ' · ' + routeLabels[http.state]), http.waitUntil && h('span', { className: 'df-muted' }, '约至 ' + http.waitUntil)),
      h('li', { 'data-route': 'browser' }, h('strong', null, '浏览器读取'), h('span', null, status.browser.configured ? routeLabels[status.browser.state] : '未配置')),
      h('li', { 'data-route': 'resource' }, h('strong', null, '媒体与字幕'), h('span', null, routeLabels[status.resource.state])))
      : null,
    h('h3', null, '暂停范围'),
    (status?.pauses ?? []).length === 0 ? h('p', { className: 'df-muted' }, '当前没有记录的暂停。') : h('ul', { className: 'df-runtime-capabilities' }, ...status.pauses.map((pause, index) => h('li', { key: index, 'data-pause': pause.scope }, h('strong', null, scopeLabels[pause.scope] ?? pause.scope), h('span', null, pause.endpoint ?? '全部接口'), h('span', { className: 'df-muted' }, [pause.held ? '需要诊断' : '冷却', pause.kind, '失败 ' + pause.failures + ' 次', '至 ' + pause.until].join(' · '))))),
    h('h3', null, '测试读取目标'),
    h('div', { className: 'df-field-group' },
      h('label', null, '类型', h('select', { value: target.endpoint, onChange: event => setTarget(current => ({ ...current, endpoint: event.target.value })) }, h('option', { value: 'video' }, '视频信息'), h('option', { value: 'search' }, '搜索'), h('option', { value: 'comments' }, '评论'), h('option', { value: 'discover' }, '热门列表'))),
      target.endpoint === 'video' && h('label', null, 'bv号', h('input', { value: target.bvid, placeholder: 'BV1xx411c7mD', onChange: event => setTarget(current => ({ ...current, bvid: event.target.value })) })),
      target.endpoint === 'search' && h('label', null, '关键词', h('input', { value: target.keyword, onChange: event => setTarget(current => ({ ...current, keyword: event.target.value })) })),
      target.endpoint === 'comments' && h('label', null, 'aid', h('input', { value: target.aid, onChange: event => setTarget(current => ({ ...current, aid: event.target.value })) }))),
    h('p', { className: 'df-note' }, '测试读取先做一次登录验证，再做一次指定接口读取；两步结果分别记录，不追加探测请求。'),
    h('h3', null, '最近的验证记录'),
    operations.length === 0 ? h('p', { className: 'df-muted' }, '还没有验证记录。') : h('ul', { className: 'df-runtime-capabilities' }, ...operations.slice(0, 8).map(operation => h('li', { key: operation.id, 'data-verification': operation.state },
      h('strong', null, (operation.kind === 'login' ? '登录验证' : '读取验证') + ' · ' + (stateLabels[operation.state] ?? operation.state)),
      h('span', { className: 'df-muted' }, new Date(operation.at).toLocaleString('zh-CN', { hour12: false }) + (operation.endpoint ? ' · ' + operation.endpoint : '') + (operation.errorCode ? ' · ' + (hint(operation.errorCode) || operation.errorCode) : '')),
      operation.result && h(Detail, { title: '验证结果', value: operation.result })))) );
}
export const managementPanels = [{ id: 'bilibili-status', component: BilibiliStatusPanel }];
