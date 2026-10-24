import { TestStorage } from '../../scripts/testing/workspace.ts';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const storage = new TestStorage(process.argv[2]);
const run = await storage.create(); await writeFile(join(run.root, 'fictional.txt'), 'TEST_CRASH_FIXTURE');
console.log(JSON.stringify({ root: run.root, id: run.id }));
setInterval(() => {}, 1000);
