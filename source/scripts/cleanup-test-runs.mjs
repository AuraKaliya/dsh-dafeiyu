import { TestStorage } from './testing/workspace.ts';
const storage = new TestStorage(), unlock = await storage.lock();
try { const result = await storage.sweep(); console.log(JSON.stringify(result)); if (result.blocked.length) process.exitCode = 1; }
finally { await unlock(); }
