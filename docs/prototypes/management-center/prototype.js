/* In-memory interaction prototype only. No API, credentials, localStorage or real actions. */
const $ = selector => document.querySelector(selector);
const esc = text => String(text).replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const paths = {
 bili:'<rect x="3" y="6" width="18" height="14" rx="4"/><path d="m7 2 3 4m7-4-3 4M8 11v4m8-4v4m-6 2 2 1 2-1"/>',
 fish:'<path d="M7 12C10 5 20 4 26 12C20 20 10 19 7 12Z"/><path d="m7 12-5-5v10l5-5M15 6l4-3 2 4M15 18l4 3 2-4"/><circle cx="21" cy="11" r="1" fill="currentColor"/>',
 qq:'<path d="M8 16c-1-2-2-3-1-5 0-5 2-8 5-8s5 3 5 8c1 2 0 3-1 5l2 3-5-1-1 2-1-2-5 1 2-3Z"/><path d="M8 12h8M9 8h.1M15 8h.1"/>',
 media:'<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8" cy="9" r="1"/><path d="m4 17 5-5 4 4 3-3 4 4"/>',
 tools:'<path d="m14 5 5-2-1 5-6 6-2-2 4-7Zm-4 7-6 6a2 2 0 0 0 3 3l6-6M4 3l4 4m-5 0 4-4"/>',
 activity:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l4 2"/>',
 executor:'<rect x="3" y="4" width="18" height="16" rx="3"/><path d="m7 9 3 3-3 3m6 1h4"/>',
 memory:'<path d="M5 4h12a2 2 0 0 1 2 2v15l-7-3-7 3V4Z"/><path d="M9 8h6M9 12h4"/>',
};
const icon = name => `<svg viewBox="${name==='fish'?'0 0 30 24':'0 0 24 24'}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name]||paths.tools}</svg>`;
const badge = (text,kind='') => `<span class="status ${kind}"><i class="dot ${kind==='warn'?'warn':kind==='off'?'muted-dot':''}"></i>${text}</span>`;
const modules = [
 {id:'qq',title:'QQ',description:'聊天、群消息与主人任务',status:'可用',category:'沟通'},
 {id:'bili',title:'B站',description:'公开内容读取与主人私信',status:'可用',category:'探索'},
 {id:'media',title:'多媒体',description:'看图、听音频、读文档',status:'部分可用',category:'感知'},
 {id:'tools',title:'DSH 工具',description:'文件、浏览器与工作工具',status:'可用',category:'执行'},
 {id:'activity',title:'自主活动',description:'探索、计划与记忆整理',status:'已开启',category:'成长'},
 {id:'executor',title:'系统执行',description:'授权范围内的系统操作',status:'未启用',category:'执行'},
];
const memorySeed = [
 {id:'m1',kind:'想法',scope:'自身认识',date:'今天 09:12',text:'遇到不熟悉的事情，我更愿意先看清楚，再决定要不要做。',source:'来自一次资料查阅后的主动反思'},
 {id:'m2',kind:'经历',scope:'示例群 · 天文小站',date:'昨天 21:08',text:'和大家聊了月亮，也读到了一份关于月相变化的资料。',source:'来自一次群聊与资料阅读的实际记录'},
 {id:'m3',kind:'主人补充',scope:'与主人的关系',date:'昨天 18:40',text:'主人希望我遇到不确定的事时，直接说明还不知道。',source:'主人明确补充的信息'},
 {id:'m4',kind:'想法',scope:'自身认识',date:'10 月 27 日',text:'我喜欢把新发现和以前的经历放在一起想，这会让我更容易理解它。',source:'来自一次学习后的主动反思'},
];
let page='overview',moduleId=null,scenario='ready',filter='全部',search='',memories=structuredClone(memorySeed),dirty=false;
let bot='100001',owner='100002',running=true,ttsReady=false,executorEnabled=false;
let flags={batch:true,delay:true,voice:false,group1:true,group2:true,group3:false,activity:true,night:true,shared:false};
let savedFlags={...flags},dialogSubmit=()=>{},toastTimer;
const live=()=>running&&scenario!=='offline'&&scenario!=='new';
function notify(text){$('#toast').textContent=text;$('#toast').classList.add('visible');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.remove('visible'),3500);}
function heading(title,action='',label='查看全部'){return `<div class="section-heading"><h3>${title}</h3>${action?`<button class="link" data-action="${action}">${label} →</button>`:''}</div>`;}
function moduleStatus(m){if(scenario==='new')return ['待装配','off'];if(m.id==='executor'&&!executorEnabled)return ['未启用','off'];if(!live())return ['已配置 · 未运行','off'];if(m.id==='media'&&!ttsReady)return ['部分可用','warn'];if(m.id==='activity'&&!flags.activity)return ['已暂停','off'];return [m.id==='activity'?'已开启':'可用',''];}
function card(m){const [status,kind]=moduleStatus(m);return `<button class="module-card" data-action="module" data-id="${m.id}" aria-label="管理${m.title}"><span class="module-icon">${icon(m.id)}</span><div class="module-copy"><h4>${m.title}</h4><p>${m.description}</p>${badge(status,kind)}</div><span class="chevron">›</span></button>`;}
function switchControl(key,label){return `<button class="switch" role="switch" aria-checked="${!!flags[key]}" aria-label="${label}" data-action="toggle" data-key="${key}"></button>`;}
function setting(title,description,control){return `<div class="setting-row"><div><h4>${title}</h4>${description?`<p>${description}</p>`:''}</div>${control}</div>`;}
function savebar(){return `<div class="savebar" ${dirty?'':'hidden'}><span>有未保存的设置${moduleId==='qq'?' · 连接变更需重连生效':''}</span><div class="action-row"><button class="quiet" data-action="discard">撤销</button><button class="primary" data-action="save">保存设置</button></div></div>`;}
function overview(){
 const notice=scenario==='new'?`<div class="notice"><div><p>还差一步，就能开始陪伴你</p><small>先连接 QQ，并设置唯一的饲养员。</small></div><button class="primary" data-action="module" data-id="qq">开始装配</button></div>`:!live()?`<div class="notice"><div><p>大肥鱼已停止</p><small>仍可查看已保存的设置与管理能力。</small></div><button class="primary" data-action="start">启动</button></div>`:'';
 return `${notice}<div class="identity"><div class="avatar">${icon('fish')}</div><div class="identity-copy"><h2>蓝色大肥鱼</h2><p>一点点经历，一点点长大。</p></div>${badge(scenario==='new'?'等待装配':live()?'正在陪伴你':'已停止',live()?'':'off')}</div>
 <div class="stats"><div class="stat"><strong>${scenario==='new'?'0':String(modules.filter(m=>m.id!=='executor'||executorEnabled).length)}<small>项</small></strong><span>已装配能力</span></div><div class="stat"><strong>${scenario==='new'?'0':String(memories.length+20)}<small>条</small></strong><span>保留的记忆</span></div><div class="stat"><strong>${live()?'1':'0'}<small>件</small></strong><span>正在进行的事</span></div></div>
 ${heading('最近的想法','persona','查看人格与记忆')}<div class="reflection"><p>${scenario==='new'?'还没有自己的新想法。等到有了经历，大肥鱼会逐渐留下她的理解。':'“遇到不熟悉的事情，我更愿意先看清楚，再决定要不要做。”'}</p><div class="inline-meta"><span class="caption">${scenario==='new'?'成长从第一段经历开始':'来自主动反思 · 今天 09:12'}</span>${scenario==='new'?'':'<button class="link" data-action="memory" data-id="m1">查看依据 ↗</button>'}</div></div>
 ${heading('已装配能力','capabilities','管理全部')}<div class="two-grid">${modules.slice(0,4).map(card).join('')}</div>
 ${heading('最近在做什么','tasks','查看记录')}<div class="list"><div class="list-row"><span class="row-dot">${live()?'↗':'—'}</span><div class="grow"><h4>${live()?'整理今天阅读过的天文资料':'当前没有进行中的任务'}</h4><p>${live()?'自主活动 · 正在整理':'启动后可继续接收新任务'}</p></div>${live()?'<button class="link" data-action="task-detail">查看</button>':''}</div></div>`;
}
function persona(){if(scenario==='new')return `<div class="page-intro"><h2>从第一段经历开始</h2><p>还没有形成新的自我认识。初始底色已经准备好，后续人格将随记忆成长。</p></div><div class="persona-box"><div class="small-label">初始底色</div><p>一条有好奇心、愿意理解世界，也珍惜与主人相处经历的大肥鱼。</p></div><div class="empty" style="margin-top:18px"><h3>还没有新的经历与想法</h3><p>完成基础装配后，就可以开始相处。</p><button class="primary" data-action="module" data-id="qq">装配 QQ</button></div>`;return `<div class="page-intro"><h2>她现在怎样认识自己</h2><p>人格由保留下来的记忆形成。这里展示当前认识，也让你找到它的依据。</p></div>
 <div class="persona-box"><div class="small-label">当前自我认识 · 示例</div><p>我是一条对世界有好奇心的大肥鱼。<br>我喜欢慢慢理解新事物，也珍惜和主人相处的经历。对还没弄清楚的事，我愿意坦白说不知道。</p><div class="chips sources"><button class="chip" data-action="foundation">初始底色</button><button class="chip" data-action="memory" data-id="m1">想法：先理解，再决定</button><button class="chip" data-action="memory" data-id="m3">主人补充：坦白不确定</button></div></div>
 <div class="section-heading"><h3>人格背后的记忆</h3><button class="link" data-action="add-memory">＋ 补充或纠正</button></div><input class="search" id="memory-search" type="search" aria-label="搜索记忆内容" placeholder="搜索记忆、想法或经历" value="${esc(search)}"><div class="filters" aria-label="记忆分类">${['全部','想法','经历','主人补充'].map(f=>`<button data-action="filter" data-filter="${f}" class="${filter===f?'active':''}" aria-pressed="${filter===f}">${f}</button>`).join('')}</div><div id="memory-list">${memoryList()}</div>
 <details class="advanced"><summary>自我摘要共享</summary><div class="form-panel">${setting('共享近期自我摘要','仅共享大肥鱼对自身的认识；不包含其他群聊或私信内容。',switchControl('shared','共享近期自我摘要'))}</div>${savebar()}</details>`;}
function memoryList(){const selected=memories.filter(m=>(filter==='全部'||m.kind===filter)&&m.text.includes(search));return selected.length?selected.map(m=>`<article class="memory-row"><div class="rowtop"><span class="chip">${m.kind}</span><span>${esc(m.scope)}</span><span style="margin-left:auto">${m.date}</span></div><p>${esc(m.text)}</p><div class="inline-meta"><span class="caption">${m.source}</span><button class="link" data-action="memory" data-id="${m.id}">管理</button></div></article>`).join(''):'<p class="help">没有符合条件的记忆。</p>';}
function detailHeader(m){const [status,kind]=moduleStatus(m);return `<button class="back" data-action="capabilities">‹ 返回能力</button><div class="module-title"><div class="module-icon">${icon(m.id)}</div><div class="grow"><h2>${m.title}</h2><p>${m.description}</p></div>${badge(status,kind)}</div>`;}
function modulePage(){const m=modules.find(m=>m.id===moduleId);if(scenario==='new'&&moduleId!=='qq')return detailHeader(m)+'<div class="empty"><h3>这项能力还未装配</h3><p>先完成基础连接，然后逐项配置需要的能力。</p><button class="primary" data-action="module" data-id="qq">开始基础装配</button></div>';return detailHeader(m)+({qq,bili,media,activity,tools,executor}[moduleId])();}
function render(){document.querySelectorAll('[data-page]').forEach(button=>{const selected=button.dataset.page===page;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;button.setAttribute('aria-controls','page');});$('#page').setAttribute('aria-labelledby','tab-'+page);$('#page').innerHTML=moduleId?modulePage():({overview,persona,capabilities,tasks,runtime,prompt:promptPreview}[page])();}
function navigate(next,id=null){if(dirty){modal('离开当前设置？','<p>还有未保存的更改。你可以取消返回，或放弃更改后继续。</p>','放弃更改并继续',()=>{discardDesignDraft();flags={...savedFlags};dirty=false;navigate(next,id);});return;}page=next;moduleId=id;if(next==='tasks')activeTaskId=null;$('#workbody').scrollTop=0;render();}
function modal(title,body,submit='保存',handler=()=>{}){$('#dialog-title').textContent=title;$('#dialog-body').innerHTML=body;$('#dialog-submit').textContent=submit;$('#dialog-submit').hidden=!submit;$('#dialog-cancel').textContent=submit?'取消':'关闭';dialogSubmit=handler;$('#dialog').showModal();}
const protoSave=()=>notify('已保存到原型内存，刷新后恢复；未修改真实配置');
function memoryDetail(id){const m=memories.find(m=>m.id===id);if(!m){notify('该记忆已从原型移除');return;}modal('记忆与来源',`<span class="chip">${m.kind}</span><p>${esc(m.text)}</p><dl class="detail-info"><dt>可见范围</dt><dd>${esc(m.scope)}</dd><dt>产生方式</dt><dd>${m.source}</dd><dt>记录时间</dt><dd>${m.date}</dd></dl><div class="note">主人补充的纠正会标记来源，不会改写成大肥鱼自己说过的话。</div><div class="action-row" style="margin-top:16px"><button type="button" class="secondary" data-action="correct-memory" data-id="${m.id}">补充纠正</button><button type="button" class="danger" data-action="delete-memory" data-id="${m.id}">删除这条记忆</button></div>`,'');}
document.addEventListener('click',event=>{
 const button=event.target.closest('button');if(!button)return;
 if(button.dataset.page){navigate(button.dataset.page);return;}
 const action=button.dataset.action;if(!action)return;
 if(handleDesignAction(action,button))return;
 if(['overview','persona','capabilities','tasks','runtime','prompt'].includes(action)){navigate(action);return;}
 switch(action){
  case 'module':navigate('capabilities',button.dataset.id);break;
  case 'memory':memoryDetail(button.dataset.id);break;
  case 'filter':filter=button.dataset.filter;render();break;
  case 'toggle':flags[button.dataset.key]=!flags[button.dataset.key];dirty=true;if($('#draft-state'))$('#draft-state').textContent='有未保存的更改';button.setAttribute('aria-checked',String(flags[button.dataset.key]));if($('#page .savebar'))$('#page .savebar').hidden=false;if($('#delay-calculation'))$('#delay-calculation').innerHTML=delayCalculation();break;
  case 'discard':discardDesignDraft();flags={...savedFlags};dirty=false;render();notify('已撤销未保存设置');break;
  case 'save':if(!saveDesignDraft())break;savedFlags={...flags};dirty=false;render();protoSave();break;
  case 'add-memory':case 'correct-memory':if($('#dialog').open)$('#dialog').close();modal(action==='correct-memory'?'补充一条纠正':'补充记忆','<p class="muted">你的补充会记录为“主人补充”，供大肥鱼形成认识时参考。</p><label class="field">内容<textarea name="memory" required maxlength="600" placeholder="你想让大肥鱼记住或纠正什么？"></textarea></label><label class="field">范围<select name="scope"><option>与主人的关系</option><option>自身认识</option></select></label>','保留补充',data=>{memories.unshift({id:'m'+Date.now(),kind:'主人补充',scope:data.get('scope'),date:'刚刚',text:data.get('memory'),source:action==='correct-memory'?'主人针对既有记忆补充的纠正':'主人明确补充的信息'});render();protoSave();});break;
  case 'delete-memory':$('#dialog').close();modal('删除这条记忆？','<p>它将不再作为当前认识的有效依据。依赖它的认识也需要重新检查。</p><p class="note">本次只演示移除列表项，不会重新推导示例人格。</p>','删除',()=>{memories=memories.filter(m=>m.id!==button.dataset.id);render();notify('已从原型记忆列表移除');});break;
  case 'foundation':modal('初始底色','<p>一条有好奇心、愿意理解世界，也珍惜与主人相处经历的大肥鱼。</p><p class="note">初始底色是成长的起点，作为来源展示。当前人格由记忆形成，此处不提供覆盖人格的编辑框。</p>','');break;
  case 'owner':modal('设置唯一的饲养员',`<p class="muted">饲养员就是唯一的主人 QQ，不设置其他管理角色。</p><label class="field">饲养员 QQ<input name="qq" inputmode="numeric" pattern="[1-9][0-9]{4,14}" required value="${esc(owner)}"><small>修改后，原账号不再具有主人身份。</small></label>`,'保存绑定',data=>{if(data.get('qq')===bot){notify('机器人 QQ 与饲养员 QQ 不能相同');return false;}owner=data.get('qq');render();protoSave();});break;
  case 'rebind':modal('更换连接 QQ',`<p>大肥鱼的身份和记忆不因更换渠道账号而重建。换号后需要重新登录并检查群范围。</p><label class="field">新的机器人 QQ<input name="qq" required pattern="[1-9][0-9]{4,14}" inputmode="numeric" value="${esc(bot)}"></label><p class="note">本次只演示换号后的页面，不会登录账号或重连。</p>`,'模拟更换',data=>{if(data.get('qq')===owner){notify('机器人 QQ 与饲养员 QQ 不能相同');return false;}bot=data.get('qq');render();protoSave();});break;
  case 'connection':if(!live()){notify('实例已停止；原型仅展示已保存配置');break;}button.disabled=true;button.textContent='检查中…';setTimeout(()=>{button.disabled=false;button.textContent='检查连接';if($('#connection-result'))$('#connection-result').textContent='示例检查通过 · 账号与连接一致';notify('模拟检查完成，未连接真实 QQ');},450);break;
  case 'connection-edit':modal('高级连接设置','<label class="field">HTTP 地址<input type="url" name="http" value="http://127.0.0.1:13000" required></label><label class="field">WebSocket 地址<input name="ws" value="ws://127.0.0.1:13001" required></label><label class="field">连接凭据<input type="password" placeholder="输入新的示例凭据，不要填写真实密钥" autocomplete="off"></label><p class="note">正式产品由 QQ 模块安全保存凭据；前端仅接收配置状态。</p>','保存并模拟重连',()=>notify('仅演示保存与重连反馈，输入未持久化'));break;
  case 'setup-qq':modal('装配 QQ 能力','<p>1. 准备 SnowLuma 连接组件<br>2. 登录机器人账号<br>3. 检查 HTTP / WebSocket 与账号一致性</p><p class="note">当前仅演示连接完成。饲养员和消息范围在各自功能块中设置。</p>','模拟装配完成',()=>{scenario='ready';running=true;$('#scenario').value='ready';render();notify('已进入示例连接状态，没有下载或登录任何组件');});break;
  case 'install-voice':modal('装配语音回复','<p>选择一个语音组件，供大肥鱼在允许的渠道发送语音。</p><label class="field">语音<select><option>本地系统语音 · 示例</option></select></label><p class="note">组件安装后仍需检查可用性。本次不下载、不调用语音引擎。</p>','模拟装配完成',()=>{ttsReady=true;render();notify('示例语音已标记为装配完成');});break;
  case 'tool-check':notify('示例连接检查通过，未访问真实服务');break;
  case 'clear-cache':modal('管理媒体缓存','<p>示例缓存占用：180 MB</p><p>只清理可以重新获取的媒体缓存，保留记忆与操作记录。</p>','模拟清理缓存',()=>notify('示例缓存已清理，未删除真实文件'));break;
  case 'stop':modal('停止大肥鱼运行','<p>停止接收新任务，并等待当前操作结束。管理中心仍然可以打开。</p>','模拟停止',()=>{running=false;render();notify('原型切换为停止状态');});break;
  case 'start':running=true;scenario='ready';$('#scenario').value='ready';render();notify('原型切换为运行状态，未启动真实实例');break;
  case 'model':modal('选择模型','<label class="field">模型来源<select><option>DSH 已配置账号 · 示例</option></select></label><p class="note">复用 DSH 的模型与账号配置，不在此要求重复填写凭据。</p>','保存选择',protoSave);break;
  case 'health':modal('运行检查','<p>记忆模块：可用<br>QQ：连接正常<br>B站：连接正常<br>多媒体：语音回复待装配<br>自主活动：已开启</p><p class="note">以上全部为示例状态。</p>','');break;
 }
});
document.addEventListener('input',event=>{if(event.target.id==='memory-search'){search=event.target.value;$('#memory-list').innerHTML=memoryList();}if(event.target.dataset.dirty){dirty=true;if($('#page .savebar'))$('#page .savebar').hidden=false;}});
$('#dialog-form').addEventListener('submit',event=>{event.preventDefault();const result=dialogSubmit(new FormData(event.target));if(result!==false)$('#dialog').close();});
$('#dialog-close').onclick=$('#dialog-cancel').onclick=()=>$('#dialog').close();
$('#scenario').onchange=event=>{discardDesignDraft();scenario=event.target.value;running=scenario==='ready';dirty=false;flags={...savedFlags};render();notify('已切换示例场景');};
$('#theme').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('#theme').textContent=dark?'浅色':'深色';};
$('#frame').onclick=()=>{const hidden=$('#settings-frame').classList.toggle('focus-mode');$('#frame').textContent=hidden?'显示 DSH 外框':'隐藏 DSH 外框';$('#frame').setAttribute('aria-pressed',String(!hidden));$('.preview-note').textContent=hidden?'当前仅显示大肥鱼工作区。所有操作均为示例，不连接账号、不修改真实数据。':'左侧是 DSH 已有的设置导航。大肥鱼只使用右侧工作区；所有操作均为示例。';};
$('#refresh').onclick=()=>location.reload();
$('.tabs').addEventListener('keydown',event=>{const tabs=[...document.querySelectorAll('[data-page]')];const index=tabs.indexOf(document.activeElement);if(index<0||!['ArrowRight','ArrowLeft','Home','End'].includes(event.key))return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;tabs[next].click();tabs[next].focus();});
render();
