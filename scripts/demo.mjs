import {z} from 'zod';
import {fixtureAction} from '../tests/fixture-action.js';
// Local acceptance harness: real DSH plugins, scripted model, no remote transport.
import { harness, textReply, call } from '../build-tests/harness.js';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';

let turn = 0;
const root = resolve('.runtime', 'demos', randomUUID());
const h = await harness(root, () => {
  turn++;
  if (turn === 1) return call('demo_echo', { text: '你好，大肥鱼' });
  return textReply(turn === 2 ? '测试能力已经返回，我在本地模拟会话里回复你。' : '这是另一个独立会话。');
});
try {
  h.core.registerExtension({ id: 'demo-echo', version: '0.1.0', protocolVersion:4, agentId: 'dafeiyu', actions: [fixtureAction(h.core,'demo-echo',{id:'demo_echo',description:'本地演示用回显能力',inputSchema:z.strictObject({text:z.string().describe('回显内容')}),work:async args => ({ echo: args.text ?? '' })})] });
  const first = h.simulator.send('主人测试窗口', '请使用回显能力。', { id: 'demo-1' });
  await h.core.whenIdle();
  h.simulator.send('群聊测试窗口', '你好', { id: 'demo-2' });
  await h.core.whenIdle();
  console.log('本地演示（真实DSH运行时 + 模拟模型；没有调用远端API）：');
  console.log(JSON.stringify(h.simulator.deliveries, null, 2));
  console.log('第一条消息的行为时间线：');
  console.table(h.core.journal.events(h.core.journal.get(first.id).route).map(event => ({ seq: event.seq, type: event.type, plugin: event.plugin })));
  console.log('本次运行数据：' + root);
} finally { await h.close(); }
