import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';
import { logActivity } from './db.js';

// The Update / Restart buttons. This process only drops a request file in <data>/control/queue; a small
// helper on the server (scripts/control, installed by scripts/install-control.sh) picks it up and runs one
// action from a fixed list. The dashboard itself has no access to docker or the host.

export const ACTIONS: Record<string, string> = {
  update: 'Update everything',
  'auto-update': 'Automatic update',
  'restart-all': 'Restart everything',
  'restart-dashboard': 'Restart the dashboard',
  'restart-buddy': 'Restart the Discord bots',
  'restart-trends': 'Restart UEFN Trends',
  reboot: 'Reboot the server',
};

const dir = () => join(config.dataDir, 'control');
const readJson = <T>(file: string): T | null => {
  try { return JSON.parse(readFileSync(join(dir(), file), 'utf8')) as T; } catch { return null; }
};

export interface ControlStatus { state: 'idle' | 'running' | 'done' | 'failed'; action?: string; step?: string; note?: string; startedAt?: number; finishedAt?: number | null; ok?: boolean | null }

export function controlState() {
  let alive = 0;
  try { alive = Number(readFileSync(join(dir(), 'alive'), 'utf8').trim()) || 0; } catch { /* not installed */ }
  let log = '';
  try { log = readFileSync(join(dir(), 'log.txt'), 'utf8').split('\n').slice(-80).join('\n'); } catch { /* no run yet */ }
  const queued = existsSync(join(dir(), 'queue')) ? readdirSync(join(dir(), 'queue')).length : 0;
  return {
    helperInstalled: Date.now() / 1000 - alive < 40,
    autoUpdate: existsSync(join(dir(), 'autoupdate')),
    status: readJson<ControlStatus>('status.json') ?? { state: 'idle' as const },
    versions: readJson<{ checkedAt: number; apps: { id: string; label: string; hash: string; date: number; subject: string; behind: number; error?: boolean; blocked?: boolean }[] }>('versions.json'),
    queued,
    log,
  };
}

export function setAutoUpdate(enabled: boolean, who: string) {
  mkdirSync(dir(), { recursive: true });
  if (enabled) writeFileSync(join(dir(), 'autoupdate'), '');
  else rmSync(join(dir(), 'autoupdate'), { force: true });
  writeFileSync(join(dir(), 'autoupdate.configured'), '');   // we have a choice now: the installer must not switch it back on
  logActivity(`Automatic updates turned ${enabled ? 'on' : 'off'}`, who);
}

export function requestAction(action: string, who: string) {
  if (!ACTIONS[action] || action === 'auto-update') throw Object.assign(new Error('Unknown action'), { statusCode: 400 });
  const s = controlState();
  if (!s.helperInstalled) throw Object.assign(new Error('The server helper is not installed yet (see the Server box on the Status page)'), { statusCode: 409 });
  if (s.status.state === 'running' || s.queued > 0) throw Object.assign(new Error('Something is already running, wait until it is done'), { statusCode: 409 });
  mkdirSync(join(dir(), 'queue'), { recursive: true });
  writeFileSync(join(dir(), 'queue', `${Date.now()}.req`), action);
  logActivity(`${ACTIONS[action]} (button)`, who);
}
