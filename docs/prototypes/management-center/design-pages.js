/* Product specification prototype. Settings and actions below are local simulations, not backend APIs. */
const draftDefaults = {
 bili:{publicEnabled:true,browser:true,dm:true,accountUid:'200001',ownerUid:'200002',interval:1,timeout:15,responseMiB:4,mediaMiB:64,pollSeconds:30,tasks:true,deliverResults:true},
 qq:{quiet:5,maxWait:15,maxMessages:10,delayMin:2,delayStep:20,delayMax:10,messageGap:650,example:'你好，今天也有一些新的发现想和你分享。',names:'大肥鱼，蓝色大肥鱼',historyHours:24,observationMinutes:15,observationMessages:12,observationBytes:4000,receiveImages:true,receiveAudio:true,receiveVideo:false,receiveDocuments:true,sendImages:true,sendAudio:false,connectorMode:'existing'},
 media:{maxAsset:64,cache:1024,timeout:120,language:'auto',visionModel:'DSH 视觉路由 · 示例',frames:4,voice:'系统默认语音 · 示例'},
 tools:{filesRead:true,filesWrite:false,browseRead:true,browseWrite:false,pluginInstall:false,roots:'大肥鱼工作目录',timeout:120},
 executor:{enabled:false,ownerTasks:true,autonomous:false,timeout:300,grace:0.5,roots:'大肥鱼工作目录',processes:'Node.js、PowerShell（固定程序）'},
 activity:{enabled:true,idleSeconds:60,intervalMinutes:10,quietStart:'23:00',quietEnd:'08:00',plans:true,memory:true,explore:true,media:true,bili:true,tools:false,tokenBudgetWan:10,minutes:15},
};
let productDraft=structuredClone(draftDefaults),productSaved=structuredClone(draftDefaults);
let activeTaskId=null,taskFilter='全部',taskDetailTab='概况',promptScene='qq';
let admissionExample={completedActivities:0,beforeSeconds:0,currentSeconds:120,beforeWan:0,currentWan:12},budgetPhase='after';
const taskRows=[
 {id:'A-014',title:'整理今天阅读过的天文资料',state:'运行中',origin:'自主活动',scope:'公开资料',module:'tools',goal:'阅读两份月相资料，区分事实与自己的理解。',tokens:6200,seconds:120,step:'整理已读资料',actions:['pause','cancel'],receipt:'已确认读取 2 份资料；没有外部写入',thought:'尚未保留新的想法',result:null},
 {id:'T-028',title:'整理主人发来的活动资料',state:'等待补充',origin:'主人 QQ',scope:'主人私聊',module:'qq',goal:'按主人希望的时间范围整理活动清单。',tokens:3100,seconds:68,step:'等待主人确认时间范围',actions:['supply','cancel'],receipt:'已确认读取附件；尚未生成最终文件',thought:'发现资料的日期范围不完整，已保留疑问',result:null},
 {id:'T-027',title:'整理本周阅读笔记',state:'已暂停',origin:'主人 QQ',scope:'主人私聊',module:'tools',goal:'将已选资料整理成阅读笔记。',tokens:5200,seconds:95,step:'已有可用检查点',actions:['resume','cancel'],receipt:'已读取 3 份资料；文件写入尚未开始',thought:'已记录下一步打算',result:null},
 {id:'T-026',title:'把整理结果发送给主人',state:'结果待核实',origin:'主人 QQ',scope:'主人私聊',module:'qq',goal:'发送已整理完成的说明。',tokens:1900,seconds:32,step:'发送后未收到可确认的回执',actions:['inspect'],receipt:'发送效果未知；保留实际尝试记录',thought:'这次任务未附带新的自我反思',result:'说明已经生成，但不能确认是否送达。'},
 {id:'T-025',title:'查阅月相变化的资料',state:'已完成',origin:'自主活动',scope:'公开资料',module:'tools',goal:'理解月相变化，并记录实际看到的材料。',tokens:4400,seconds:87,step:'结果已保存',actions:['result','new-task'],receipt:'两次公开内容读取已确认',thought:'先把事实看清楚，再决定自己的看法',result:'月相是观察角度变化产生的现象。本次只阅读了文字资料，未观看完整视频。'},
];
function specificationNote(text){return `<details class="design-note"><summary>设计对照 · 当前后端与本轮提案</summary><p>${text}</p></details>`;}
function intro(title,text){return `<div class="explanation"><strong>${title}</strong><p>${text}</p></div>`;}
function fieldLabel(text,hint){return `<span>${text}</span>${hint?`<small>${hint}</small>`:''}`;}
function numberField(group,key,label,unit,min,max,step=1,hint=''){return `<label class="parameter">${fieldLabel(label,hint)}<span class="input-unit"><input type="number" data-setting="${group}.${key}" value="${productDraft[group][key]}" min="${min}" max="${max}" step="${step}" required aria-label="${label}"><span>${unit}</span></span><small class="range">${min}–${max} ${unit}</small></label>`;}
function textField(group,key,label,hint='',type='text'){return `<label class="parameter full-span">${fieldLabel(label,hint)}<input type="${type}" data-setting="${group}.${key}" value="${esc(productDraft[group][key])}" aria-label="${label}" required></label>`;}
function productSwitch(group,key,label){return `<button class="switch" role="switch" aria-label="${label}" aria-checked="${productDraft[group][key]}" data-action="product-toggle" data-key="${group}.${key}"></button>`;}
function sectionBox(title,description,body,open=true){return `<details class="settings-section" ${open?'open':''}><summary><span>${title}</span><small>${description}</small></summary><div class="section-content">${body}</div></details>`;}
function moduleSave(label='保存到原型'){return `<div class="product-save"><span id="draft-state">${dirty?'有未保存的更改':'显示已保存的示例设置'}</span><div class="action-row"><button class="quiet" data-action="discard">撤销</button><button class="primary" data-action="save">${label}</button></div><p class="inline-error" id="draft-error" role="alert"></p></div>`;}
function markProductDirty(){dirty=true;if($('#draft-state'))$('#draft-state').textContent='有未保存的更改';}
function discardDesignDraft(){productDraft=structuredClone(productSaved);}
function saveDesignDraft(){
 const fields=[...document.querySelectorAll('[data-setting]')];const invalid=fields.find(input=>!input.checkValidity());let error='';
 if(invalid){invalid.reportValidity();error='请修正超出范围或缺失的参数。';}
 const q=productDraft.qq,a=productDraft.activity;
 if(moduleId==='bili'&&productDraft.bili.accountUid===productDraft.bili.ownerUid)error='内容账号与主人 UID 不能相同。';
 if(moduleId==='bili'&&!productDraft.bili.publicEnabled&&!productDraft.bili.dm)error='至少保留公开读取或主人私信，或从能力装配中移除此模块。';
 if(moduleId==='qq'&&q.maxWait<q.quiet)error='最长合并等待不能小于静默等待。';
 if(moduleId==='qq'&&q.delayMax<q.delayMin)error='最大延迟不能小于最少延迟。';
 if(moduleId==='activity'&&!a.plans&&!a.memory&&!a.explore&&a.enabled)error='至少允许一种活动，或关闭自主活动。';
 if(moduleId==='activity'&&a.explore&&!a.bili&&!a.media&&!a.tools)error='允许探索时，至少选择一项探索能力。';
 if(moduleId==='activity'&&a.quietStart===a.quietEnd)error='安静时段起止相同；如需全天停用，请关闭自主活动。';
 if(error){if($('#draft-error'))$('#draft-error').textContent=error;notify(error);return false;}
 productSaved=structuredClone(productDraft);flags.activity=productSaved.activity.enabled;if($('#draft-state'))$('#draft-state').textContent='示例设置已保存';return true;
}
function delayCalculation(){if(!flags.delay)return '<strong>自然发送延迟已关闭</strong><span>首条回复不额外等待；连续消息间隔独立设置。</span>';const q=productDraft.qq,n=Array.from(q.example).length,valid=q.delayMax>=q.delayMin;return valid?`<strong>${n} 字符 → ${Math.min(q.delayMax,q.delayMin+n*q.delayStep/1000).toFixed(2)} 秒</strong><span>示例：100 字 → ${Math.min(q.delayMax,q.delayMin+100*q.delayStep/1000).toFixed(2)} 秒；400 字 → ${Math.min(q.delayMax,q.delayMin+400*q.delayStep/1000).toFixed(2)} 秒</span>`:'<strong>最大延迟不能小于最少延迟</strong>';}
function tasks(){if(scenario==='new')return '<div class="empty"><h3>还没有任务记录</h3><p>任务的目标、执行、回执、结果与反思会在这里分别保存。</p></div>';if(activeTaskId)return taskDetail(taskRows.find(t=>t.id===activeTaskId));const list=taskRows.filter(t=>taskFilter==='全部'||t.state===taskFilter);return intro('任务不是一行“成功 / 失败”','查看目标、来源、执行步骤、实际效果、产物、消耗和自己的想法。可执行操作由任务当前状态与权限共同决定。')+`<div class="filters" aria-label="任务状态筛选">${['全部','运行中','等待补充','已暂停','结果待核实','已完成'].map(f=>`<button class="${f===taskFilter?'active':''}" aria-pressed="${f===taskFilter}" data-action="task-filter" data-filter="${f}">${f}</button>`).join('')}</div><div class="task-list">${list.map(t=>`<button class="task-card" data-action="task-open" data-id="${t.id}"><div class="inline-meta"><span class="caption">${t.id} · ${t.origin}</span><span class="task-state ${t.state==='结果待核实'?'warning':''}">${t.state}</span></div><h3>${t.title}</h3><p>${t.step}</p><div class="inline-meta"><span>${(t.tokens/10000).toLocaleString()} 万 Token · ${t.seconds} 秒</span><span class="link">查看详情 →</span></div></button>`).join('')||'<p class="help">没有符合条件的任务。</p>'}</div>`+specificationNote('已有任务/Run、检查点、异议、结果与操作回执；还缺统一的主人管理查询和状态操作接口。管理页应消费 allowedActions 与不可用原因，而不是根据一个状态字符串在前端猜测能否重试。');}
function taskDetail(t){const unknown=t.state==='结果待核实';return `<button class="back" data-action="task-list">‹ 返回任务列表</button><div class="page-intro"><div class="inline-meta"><span class="caption">${t.id} · ${t.origin}</span><span class="task-state ${unknown?'warning':''}">${t.state}</span></div><h2 style="margin-top:8px">${t.title}</h2><p>${t.goal}</p></div><div class="filters" aria-label="任务详情分类">${['概况','执行记录','任务结果','自主反思','用量记录','上下文'].map(tab=>`<button data-action="task-detail-tab" data-tab="${tab}" class="${tab===taskDetailTab?'active':''}">${tab}</button>`).join('')}</div>${taskDetailBody(t)}${heading('当前可以执行的操作')}<div class="action-row">${t.actions.map(a=>`<button class="${a==='cancel'?'danger':'secondary'}" data-action="task-command" data-command="${a}" data-id="${t.id}">${{pause:'请求暂停',cancel:'取消任务',supply:'补充说明',resume:'从检查点继续',inspect:'查看并核对回执',result:'查看产物', 'new-task':'基于结果创建新任务'}[a]}</button>`).join('')}</div>${unknown?'<div class="note" style="margin-top:12px">不能自动重发或重新执行：上次发送可能已经生效。核对回执只检查已有结果，不重新发送。</div>':'<p class="help">取消不回滚已完成的操作；继续使用现有检查点，不重演已确认的步骤。</p>'}`;}
function handleDesignAction(action,button){
 if(handleBiliAction(action,button))return true;
 if(handleStickerAction(action,button))return true;
 if(action==='product-toggle'){const [g,key]=button.dataset.key.split('.');productDraft[g][key]=!productDraft[g][key];button.setAttribute('aria-checked',String(productDraft[g][key]));markProductDirty();if($('#budget-result'))$('#budget-result').innerHTML=budgetDecision();return true;}
 if(action==='connector-detail'){modal('SnowLuma · QQ 连接组件','<dl class="facts-grid"><dt>职责</dt><dd>登录 QQ，并向大肥鱼提供消息接口。</dd><dt>当前模式</dt><dd>连接已有服务 · 示例</dd><dt>版本</dt><dd>2.1.1 · 示例，未检测真实主机</dd><dt>管理范围</dt><dd>定位安装、检查版本、装配依赖、显示启动/登录状态。</dd></dl><p class="note">正式产品应显示模块维护的来源与版本校验信息。本原型不提供未经核验的下载链接。</p>','模拟检查组件',()=>notify('示例组件检测完成；未访问或安装真实软件'));return true;}
 if(action==='component-view'){const info={decoder:['FFmpeg / ffprobe','负责探测、解码和抽帧，不负责理解画面。'],speech:['Whisper 语音识别','将实际语音转成带时间位置的文本。'],events:['YAMNet 声音事件','识别声音事件并返回标签与原始分数。'],document:['Python 文档读取器','解析文字和结构；扫描文档缺少文字层时需要另外的 OCR 能力。']}[button.dataset.id];modal(info[0],`<p>${info[1]}</p><dl class="facts-grid"><dt>安装状态</dt><dd>示例：已安装</dd><dt>可用性</dt><dd>示例：组件检查通过</dd><dt>检查项目</dt><dd>程序/模型版本、文件可用性、处理结果范围。</dd></dl>`,'模拟检查',()=>notify('只演示组件检查结果，未调用真实后端'));return true;}
 if(action==='media-check'){modal('音频处理检查','<p>正式检查可使用用户选定的短样本：确认实际 PCM、转写、时间范围和声音事件输出。</p><p class="note">本原型不启动音频引擎，不将组件就绪描述为真实音频理解验收。</p>','查看示例结果',()=>notify('示例：转写 1 段、覆盖 3 秒；未执行真实识别'));return true;}
 if(action==='executor-probe'){modal('执行环境检查','<p>程序版本：示例已识别<br>DSH 配置：示例匹配<br>操作系统身份：未核验<br>长期自主授权：未配置</p><p class="note">只有实际检查通过才会开放执行。前端无法自行提升系统权限。</p>','');return true;}
 if(action==='task-filter'){taskFilter=button.dataset.filter;render();return true;}
 if(action==='task-open'){activeTaskId=button.dataset.id;taskDetailTab='概况';render();$('#workbody').scrollTop=0;return true;}
 if(action==='task-list'){activeTaskId=null;render();$('#workbody').scrollTop=0;return true;}
 if(action==='task-detail-tab'){taskDetailTab=button.dataset.tab;render();return true;}
 if(action==='task-detail'){navigate('tasks');activeTaskId='A-014';taskDetailTab='概况';render();return true;}
 if(action==='task-command'){const t=taskRows.find(t=>t.id===button.dataset.id),cmd=button.dataset.command;
  if(cmd==='result'){modal('任务产物',`<p>${esc(t.result||'当前仅有步骤记录，尚无最终产物。')}</p><p class="note">产物与回执保持原有来源范围；这里是示例内容。</p>`,'');return true;}
  if(cmd==='inspect'){modal('核对发送回执','<p>发送请求已发出，但回执未确认。当前状态仍是效果未知。</p><dl class="facts-grid"><dt>可以做</dt><dd>读取已有回执、查询平台可核验结果。</dd><dt>不能做</dt><dd>把核对当作重发，也不能把无回执判为未发送。</dd></dl>','模拟核对',()=>notify('示例核对没有新的证据，继续保留“结果待核实”'));return true;}
  if(cmd==='supply'){modal('补充任务说明',`<p>${t.title}</p><label class="field">补充内容<textarea name="supplement" required maxlength="1000" placeholder="例如：请整理最近一周的资料。"></textarea></label>`,'提交补充',()=>{t.state='已暂停';t.step='已收到补充；可从有效检查点继续';t.actions=['resume','cancel'];render();notify('已更新示例任务，未提交真实消息');});return true;}
  if(cmd==='new-task'){modal('基于结果创建新任务','<label class="field">新的目标<textarea name="goal" required placeholder="在已有结果基础上，接下来要做什么？"></textarea></label><p class="note">创建关联的新任务，不自动重放原任务的已确认操作。</p>','创建示例任务',data=>{taskRows.unshift({id:'T-'+Date.now().toString().slice(-4),title:String(data.get('goal')).slice(0,40),state:'已暂停',origin:'主人管理中心',scope:'主人',module:'tools',goal:data.get('goal'),tokens:0,seconds:0,step:'等待按新目标受理',actions:['cancel'],receipt:'尚未执行',thought:'暂无',result:null});activeTaskId=null;render();notify('只创建了浏览器内的示例记录');});return true;}
  const label={pause:'请求暂停',cancel:'取消任务',resume:'从检查点继续'}[cmd];modal(label,`<p>${t.title}</p><p class="note">${cmd==='resume'?'将再次检查任务权限、来源与检查点，不重复已确认的步骤。':'停止后续活动，已完成的实际操作不会回滚。'}</p>`,label,()=>{t.state=cmd==='resume'?'运行中':cmd==='pause'?'已暂停':'已取消';t.step=cmd==='resume'?'从已验证检查点继续':cmd==='pause'?'已到达可暂停点':'不再继续执行';t.actions=cmd==='resume'?['pause','cancel']:cmd==='pause'?['resume','cancel']:[];render();notify('示例任务状态已更新，未操作真实任务');});return true;
 }
 if(action==='prompt-from-task'){const t=taskRows.find(t=>t.id===button.dataset.id);promptScene=t.origin==='自主活动'?'activity':'task';navigate('prompt');return true;}
 if(action==='prompt-jump'){const id=button.dataset.id;if(['persona','runtime','tasks','capabilities'].includes(id))navigate(id);else navigate('capabilities',id);return true;}
 return false;
}
document.addEventListener('input',event=>{
 const input=event.target;if(input.dataset.setting){const [group,key]=input.dataset.setting.split('.');productDraft[group][key]=input.type==='number'?Number(input.value):input.value;markProductDirty();}
 if(input.id==='delay-example')productDraft.qq.example=input.value;
 if((input.dataset.setting?.startsWith('qq.delay')||input.id==='delay-example')&&document.querySelector('#delay-calculation'))document.querySelector('#delay-calculation').innerHTML=delayCalculation();
 if(input.dataset.example)admissionExample[input.dataset.example]=Number(input.value)||0;
 if((input.dataset.example||input.dataset.setting?.startsWith('activity.'))&&document.querySelector('#budget-result'))document.querySelector('#budget-result').innerHTML=budgetDecision();
});
document.addEventListener('change',event=>{if(event.target.id==='prompt-scene'){promptScene=event.target.value;render();}if(event.target.id==='budget-phase'){budgetPhase=event.target.value;document.querySelector('#budget-result').innerHTML=budgetDecision();}});
