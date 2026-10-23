// Real DSH services + fictional data + scripted model. No QQ, remote model, or existing history.
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { timelineFixture } from '../build-tests/timeline-fixture.js';
const root=resolve('.runtime/demos','timeline-'+randomUUID());
const h=await timelineFixture(root);
try {
  const item=await h.seed('private-demo','演示原文：这是一条只属于当前会话的测试计划。');
  const page=await h.probe('private-demo',context=>h.timeline.search(context,{type:'message.accepted',traceId:item.id}));
  const event=await h.probe('private-demo',context=>h.timeline.open(context,{ref:page.items[0].ref}));
  if(event.status!=='ok')throw new Error('Event opening failed');
  const detail=JSON.parse(event.text);
  const sourceRef=detail.sources[0].ref;
  const original=await h.probe('private-demo',context=>h.timeline.open(context,{ref:sourceRef}));
  const denied=await h.probe('group-demo',context=>h.timeline.open(context,{ref:sourceRef}));
  if(original.status!=='ok'||denied.status!=='not_found')throw new Error('Scope validation failed');
  console.log(JSON.stringify({timeline:page,source:original,crossConversation:denied,dataDirectory:root},null,2));
} finally {await h.close();}
