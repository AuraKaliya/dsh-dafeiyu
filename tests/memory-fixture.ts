import * as Memory from '@dafeiyu/memory';
import { timelineFixture } from './timeline-fixture.js';

export async function memoryFixture(root?: string) {
  const h = await timelineFixture(root);
  const memoryFiber = await h.ctx.plugin(Memory, { agentId: 'dafeiyu', dataDir: h.root });
  const memory = h.ctx.dafeiyuMemory;
  return { ...h, memory, memoryFiber,
    evidence: async (room = 'a', text = '虚构约定：项目代号青羽842') => {
      const message = await h.seed(room, text);
      const event = h.core.journal.events(message.route).find(e => e.traceId === message.id && e.type === 'message.accepted');
      if (!event) throw new Error('Missing fixture source');
      return { ref: `dafeiyu:source:${event.id}:0`, message };
    },
    close: async () => { await memoryFiber.dispose(); await h.close(); },
  };
}
