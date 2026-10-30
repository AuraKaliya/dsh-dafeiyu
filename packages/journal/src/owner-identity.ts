import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const starts = new Map<number, number | null>();
let bootTime: number | null | undefined;

function linuxStart(pid: number): number | null {
  try {
    if (bootTime === undefined) {
      const stat = readFileSync('/proc/stat', 'utf8');
      const match = /^btime\s+(\d+)$/m.exec(stat);
      bootTime = match ? Number(match[1]) * 1000 : null;
    }
    if (bootTime === null) return null;
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const ticks = Number(fields[19]);
    if (!Number.isFinite(ticks)) return null;
    const hz = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', timeout: 1000 }).trim()) || 100;
    return bootTime + Math.round((ticks * 1000) / hz);
  } catch { return null; }
}

function windowsStart(pid: number): number | null {
  try {
    const powershell = process.env.SystemRoot
      ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`
      : 'powershell.exe';
    const output = execFileSync(powershell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      `$p=Get-CimInstance Win32_Process -Filter "ProcessId=${pid}"; if($p){([DateTimeOffset]$p.CreationDate).ToUnixTimeMilliseconds()}`],
      { encoding: 'utf8', timeout: 2000, windowsHide: true }).trim();
    if (!/^\d+$/.test(output)) return null;
    const value = Number(output);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  } catch { return null; }
}

/** OS process creation time in Unix milliseconds, cached per PID. Null means unknown. */
export function processStartTime(pid = process.pid): number | null {
  if (!Number.isSafeInteger(pid) || pid <= 0) return null;
  if (starts.has(pid)) return starts.get(pid)!;
  const value = process.platform === 'win32' ? windowsStart(pid) : process.platform === 'linux' ? linuxStart(pid) : null;
  starts.set(pid, value);
  return value;
}

/** Ownership nonce carries PID and process start time so a reused PID is not mistaken for the owner. */
export function ownerNonce(pid = process.pid): string {
  return `${pid}:${processStartTime(pid) ?? 'unknown'}:${randomUUID()}`;
}

export function nonceStart(nonce: string): { pid: number; start: number | null } | null {
  const match = /^(\d+):(\d+|unknown):/.exec(nonce);
  if (!match) return null;
  return { pid: Number(match[1]), start: match[2] === 'unknown' ? null : Number(match[2]) };
}

export function ownerAlive(pid: number, owner?: { processStartedAt?: number | null; nonce?: string; claimedAt?: string }): boolean {
  try { process.kill(pid, 0); }
  catch (error) { return !(error instanceof Error && 'code' in error && error.code === 'ESRCH'); }
  const current = processStartTime(pid);
  if (current === null) return true;
  const recorded = owner?.processStartedAt ?? (owner?.nonce ? nonceStart(owner.nonce)?.start ?? null : null);
  if (recorded !== null) return Math.abs(current - recorded) <= 2000;
  if (owner?.claimedAt) {
    const claimed = Date.parse(owner.claimedAt);
    if (Number.isFinite(claimed)) return current <= claimed + 2000 && current >= claimed - 120000;
  }
  return true;
}
