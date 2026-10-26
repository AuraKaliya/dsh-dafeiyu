import { join, resolve } from 'node:path';
import { existsSync, readFileSync, realpathSync } from 'node:fs';

/** Test-only scratch location; direct invocations fail before allocating a system Temp directory. */
export function testTempDir(): string {
  const run = process.env.DAFEIYU_TEST_RUN, worker = process.env.DAFEIYU_TEST_WORKER;
  if (!run || !worker || !resolve(worker).startsWith(resolve(run) + '\\') && !resolve(worker).startsWith(resolve(run) + '/')) throw new Error('USE_MANAGED_NPM_TEST');
  const marker = JSON.parse(readFileSync(join(worker, '.process.json'), 'utf8')) as { kind?: unknown; pid?: unknown };
  const temp = join(worker, 'tmp');
  if (marker.kind !== 'dafeiyu-test-process-v1' || marker.pid !== process.pid || !existsSync(temp) || realpathSync.native(temp).toLowerCase() !== resolve(temp).toLowerCase()) throw new Error('TEST_TEMP_OWNER_INVALID');
  return temp;
}
