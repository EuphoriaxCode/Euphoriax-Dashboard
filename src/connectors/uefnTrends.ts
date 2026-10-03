import { config } from '../config.js';
import { db, now } from '../db.js';
import { getJson, type Connector } from './types.js';

// Pulls from our own UEFN-Trends engine (github.com/EuphoriaxCode/UEFN-Trends).
export const uefnTrends: Connector = {
  name: 'UEFN Trends',
  platform: 'uefn',
  setup: 'UEFN_TRENDS_URL (e.g. http://trends-host:3100) and optionally UEFN_TRENDS_ADMIN_KEY',
  configured: () => !!config.uefnTrends.url,
  async collect() {
    const base = config.uefnTrends.url;
    const headers: Record<string, string> = config.uefnTrends.adminKey ? { 'x-api-key': config.uefnTrends.adminKey } : {};
    const save = db.prepare(`INSERT INTO trends_cache (key, json, ts) VALUES (?, ?, ?)
      ON CONFLICT(key) DO UPDATE SET json = excluded.json, ts = excluded.ts`);
    const top = await getJson(`${base}/api/v1/trends/top`, { headers });
    save.run('top', JSON.stringify(top), now());
    for (const [key, path] of [['latest', '/api/v1/trends/latest'], ['report', '/api/v1/reports/latest'], ['status', '/api/v1/status']]) {
      try { save.run(key, JSON.stringify(await getJson(`${base}${path}`, { headers })), now()); } catch { /* optional */ }
    }
    return `${top.topTrends?.length ?? 0} top trends`;
  },
};
