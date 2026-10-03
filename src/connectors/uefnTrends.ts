import { config } from '../config.js';
import { db, now, recordMetric } from '../db.js';
import { setServiceStatus } from '../monitor.js';
import { getJson, toMs, type Connector } from './types.js';

// Our own UEFN-Trends engine (github.com/EuphoriaxCode/UEFN-Trends).

export async function trendsApi<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const headers: Record<string, string> = config.uefnTrends.adminKey ? { 'x-api-key': config.uefnTrends.adminKey } : {};
  if (init.body) headers['content-type'] = 'application/json';
  return getJson<T>(`${config.uefnTrends.url}${path}`, { method: init.method ?? 'GET', headers, body: init.body ? JSON.stringify(init.body) : undefined });
}

const SOURCE_NAMES: Record<string, string> = {
  steam: 'Steam', roblox: 'Roblox', fortnite: 'Fortnite', reddit: 'Reddit', googleTrends: 'Google Trends', 'google-trends': 'Google Trends', kym: 'Know Your Meme', knowYourMeme: 'Know Your Meme',
};

export const uefnTrends: Connector = {
  name: 'UEFN Trends',
  platform: 'uefn',
  setup: 'UEFN Trends address on the Setup page',
  configured: () => !!config.uefnTrends.url,
  async collect() {
    const save = db.prepare(`INSERT INTO trends_cache (key, json, ts) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET json = excluded.json, ts = excluded.ts`);
    const top = await trendsApi('/api/v1/trends/top');
    save.run('top', JSON.stringify(top), now());
    for (const [key, path] of [['latest', '/api/v1/trends/latest'], ['report', '/api/v1/reports/latest'], ['status', '/api/v1/status']]) {
      try { save.run(key, JSON.stringify(await trendsApi(path)), now()); } catch { /* optional */ }
    }

    // Each data source of the trend engine shows up on the Status page.
    const status = db.prepare(`SELECT json FROM trends_cache WHERE key = 'status'`).get() as { json: string } | undefined;
    if (status) {
      const s = JSON.parse(status.json);
      for (const src of s.sources ?? []) {
        const st = src.status === 'HEALTHY' ? 'online' : src.status === 'DEGRADED' ? 'degraded' : src.status === 'ERROR' ? 'offline' : 'not_configured';
        const last = toMs(src.lastSuccessfulCollection);
        setServiceStatus(`trends:${src.id}`, 'trends', st,
          src.status === 'DISABLED' ? (src.disabledReason ?? 'disabled') : src.lastError && st !== 'online' ? src.lastError
            : `${src.entitiesCollected} items${last ? ` · last pull ${new Date(last).toISOString().slice(11, 16)} UTC` : ''}`,
          `Trends source · ${SOURCE_NAMES[src.id] ?? src.id}`);
      }
      recordMetric('uefn', 'ai_spent_month_usd', s.ai?.spentMonthUsd);
    }
    return `${top.topTrends?.length ?? 0} top trends`;
  },
};
