import React from 'react';
const h=React.createElement;
function MediaPanel({call,perform,ui:{Button,Detail}}){
  const [value,setValue]=React.useState(null),load=async()=>setValue(await call('status',null));
  return h('div',null,h(Button,{onClick:()=>perform(load)},'读取媒体状态'),value&&h(React.Fragment,null,
    h('p',null,'修复组件或登录态后，可为对应暂停范围允许一次实际读取。许可不代表读取成功；成功回执才解除该范围暂停。'),
    ...(value.pauses??[]).filter(row=>row.until!==0).map(row=>h('article',{key:row.key,className:'df-record'},h('strong',null,`${row.stage}：${row.code}`),
      h(Button,{onClick:()=>perform(async()=>{await call('recovery.arm',{requestId:crypto.randomUUID(),key:row.key,expectedGeneration:row.generation});await load();})},'允许下一次读取验证'),h(Detail,{title:'受影响范围',value:row}))),
    h(Detail,{title:'验证许可与结果',value:value.recovery}),h(Detail,{title:'实际读取诊断',value:value.diagnostics})));
}
export const managementPanels=[{id:'media-recovery',component:MediaPanel}];
