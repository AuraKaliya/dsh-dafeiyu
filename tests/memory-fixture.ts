import * as Memory from '@dafeiyu/memory';
import { timelineFixture } from './timeline-fixture.js';
import type { Context } from '@deepseek-ai/cordis';
import type { RetrievalDependencies } from '@dafeiyu/memory/retrieval-profile';
import type { Config as CoreConfig } from '@dafeiyu/core';

export async function memoryFixture(root?: string, options: Omit<Memory.Config, 'agentId' | 'dataDir'> = {}, dependencies?: RetrievalDependencies,context?:CoreConfig['context']) {
  const h = await timelineFixture(root,{...(context?.assembly?{}:{assembly:{recall:{enabled:false}}}),...context,regions:{'memory-persona:pending-experiences':{maxBytes:0},...context?.regions}},options,dependencies);
  const memoryFiber=h.memoryFiber!,memory=h.ctx.dafeiyuMemory;
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
