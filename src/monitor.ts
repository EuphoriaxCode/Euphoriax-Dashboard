import { existsSync, readFileSync } from 'node:fs';
import { config } from './config.js';
import { db, logActivity, now } from './db.js';
import { notify } from './notify.js';

export type Status = 'online' | 'degraded' | 'offline' | 'unknown' | 'not_configured';

interface ServiceRow { name: string; label: string | null; kind: string; status: Status; last_seen: number | null }

export function setServiceStatus(name: string, kind: string, status: Status, detail: string, label?: string, url?: string) {
  const prev = db.prepare('SELECT status, label FROM services WHERE name = ?').get(name) as ServiceRow | undefined;
  const t = now();
  const seen = status === 'online' || status === 'degraded' ? t : null;
  db.prepare(`INSERT INTO services (name, label, kind, url, status, detail, last_seen, last_check, changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name) DO UPDATE SET label = COALESCE(excluded.label, services.label), kind = excluded.kind,
      url = COALESCE(excluded.url, services.url), status = excluded.status, detail = excluded.detail,
      last_seen = COALESCE(excluded.last_seen, services.last_seen), last_check = excluded.last_check,
      changed_at = CASE WHEN services.status = excluded.status THEN services.changed_at ELSE excluded.changed_at END`)
    .run(name, label ?? null, kind, url ?? null, status, detail, seen, t, t);

  const wasUp = prev && (prev.status === 'online' || prev.status === 'degraded');
  const display = label ?? prev?.label ?? name;
  if (wasUp && status === 'offline') {
    logActivity(`${display} went OFFLINE: ${detail}`);
    // The build PC is often switched off and the Trends scrapers flap, so those do not ping anyone.
    const serious = kind !== 'machine' && kind !== 'trends';
    void notify(`🔴 **${display}** is offline - ${detail}`, { urgent: serious });
  } else if (prev?.status === 'offline' && status === 'online') {
    logActivity(`${display} is back online`);
    void notify(`🟢 **${display}** is back online`);
  }
}

/** Bots and services push heartbeats here: { name, status?, detail? }. */
export function heartbeat(name: string, status: Status = 'online', detail = '', kind = 'heartbeat') {
  setServiceStatus(kind === 'machine' ? `machine:${name}` : `bot:${name}`, kind, status, detail, name);
}

interface HttpService { name: string; url: string; expect?: number }

export function httpServices(): HttpService[] {
  const file = 'config/services.json';
  if (!existsSync(file)) return [];
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return []; }
}

export async function checkServices() {
  await Promise.all(httpServices().map(async (s) => {
    const started = Date.now();
    try {
      const res = await fetch(s.url, { signal: AbortSignal.timeout(10_000) });
      const ms = Date.now() - started;
      const ok = s.expect ? res.status === s.expect : res.ok;
      setServiceStatus(`http:${s.name}`, 'http', ok ? (ms > 3000 ? 'degraded' : 'online') : 'offline',
        `${res.status} in ${ms}ms`, s.name, s.url);
    } catch (err) {
      setServiceStatus(`http:${s.name}`, 'http', 'offline', err instanceof Error ? err.message : 'failed', s.name, s.url);
    }
  }));

  // Anything that pushes heartbeats and went quiet is offline.
  const cutoff = now() - config.heartbeatTimeoutMin * 6e4;
  const stale = db.prepare(`SELECT name, label, kind, status, last_seen FROM services
    WHERE kind IN ('heartbeat', 'machine') AND status IN ('online', 'degraded') AND COALESCE(last_seen, 0) < ?`)
    .all(cutoff) as unknown as ServiceRow[];
  for (const s of stale) {
    setServiceStatus(s.name, s.kind, 'offline', `no heartbeat for ${config.heartbeatTimeoutMin}+ min`, s.label ?? undefined);
  }

  const mode = config.aiMode;
  const ready = mode === 'openai' ? !!config.openaiKey : mode === 'api' ? !!config.anthropicKey : true;
  setServiceStatus('ai', 'connector', ready ? 'online' : 'not_configured',
    mode === 'openai' ? (ready ? `OpenAI · ${config.openaiModel}` : 'Add your OpenAI key on the Setup page')
      : mode === 'api' ? (ready ? `Claude API · ${config.aiModel}` : 'Add your Claude API key on the Setup page')
        : 'runs on the build PC (Claude subscription)', 'Daily AI analysis');
  setServiceStatus('publisher', 'connector',
    config.publisher === 'ayrshare' ? (config.ayrshareKey ? 'online' : 'not_configured')
      : config.publisher === 'webhook' ? (config.publishWebhook ? 'online' : 'not_configured') : 'online',
    `mode: ${config.publisher}`, 'Publisher (outgoing)');
}
