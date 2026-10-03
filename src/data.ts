import { db, now } from './db.js';

// Shared read-side queries used by the API and the AI analysis.

const DAY = 864e5;

export function latestMetrics() {
  const rows = db.prepare(`SELECT m.platform, m.key, m.value, m.ts FROM metrics m
    JOIN (SELECT platform, key, MAX(ts) ts FROM metrics GROUP BY platform, key) l
      ON l.platform = m.platform AND l.key = m.key AND l.ts = m.ts`).all() as any[];
  // change7d needs a number from a week ago. Until we have one (the first week after connecting), changeAll is the
  // change since the first number we saw, so the dashboard can say "since connected" instead of a misleading +0.
  const out: Record<string, Record<string, { value: number; change7d: number | null; changeAll: number | null }>> = {};
  const before = db.prepare(`SELECT value FROM metrics WHERE platform = ? AND key = ? AND ts <= ? ORDER BY ts DESC LIMIT 1`);
  const first = db.prepare(`SELECT value, ts FROM metrics WHERE platform = ? AND key = ? ORDER BY ts ASC LIMIT 1`);
  for (const r of rows) {
    const old = before.get(r.platform, r.key, r.ts - 7 * DAY) as { value: number } | undefined;
    const f = first.get(r.platform, r.key) as { value: number; ts: number } | undefined;
    (out[r.platform] ??= {})[r.key] = {
      value: r.value, change7d: old ? r.value - old.value : null, changeAll: f && f.ts < r.ts ? r.value - f.value : null,
    };
  }
  return out;
}

export function metricHistory(platform: string, key: string, days = 30) {
  return db.prepare(`SELECT ts, value FROM metrics WHERE platform = ? AND key = ? AND ts > ? ORDER BY ts`)
    .all(platform, key, now() - days * DAY) as { ts: number; value: number }[];
}

/** Content with views gained in the window (from snapshots), sorted by gain. */
export function contentPerformance({ days = 7, platform = '', limit = 50 } = {}) {
  const since = now() - days * DAY;
  return db.prepare(`
    SELECT c.*, c.views - COALESCE((
      SELECT s.views FROM content_snapshots s WHERE s.content_id = c.id AND s.ts <= ? ORDER BY s.ts DESC LIMIT 1
    ), CASE WHEN c.published_at >= ? THEN 0 ELSE c.views END) AS gained
    FROM content c WHERE (? = '' OR c.platform = ?)
    ORDER BY gained DESC, c.views DESC LIMIT ?`)
    .all(since, since, platform, platform, limit) as any[];
}

/** How many days of view snapshots we have (the 7-day view numbers only become complete after 7 days). */
export function historyDays() {
  const r = db.prepare('SELECT MIN(ts) t FROM content_snapshots').get() as { t: number | null };
  return r.t ? (now() - r.t) / DAY : 0;
}

export function viewsByPlatform(days = 7) {
  const rows = contentPerformance({ days, limit: 100000 });
  const out: Record<string, { gained: number; posts: number; total: number }> = {};
  for (const r of rows) {
    const p = (out[r.platform] ??= { gained: 0, posts: 0, total: 0 });
    p.gained += r.gained; p.total += r.views; p.posts++;
  }
  return out;
}

export function products() {
  return db.prepare('SELECT * FROM products ORDER BY revenue_cents DESC, members DESC').all() as any[];
}

export function recentSales(days = 30) {
  return db.prepare('SELECT * FROM sales WHERE ts > ? ORDER BY ts DESC LIMIT 200').all(now() - days * DAY) as any[];
}

export function recentSignals(days = 2, limit = 300) {
  return db.prepare('SELECT * FROM signals WHERE ts > ? ORDER BY ts DESC LIMIT ?').all(now() - days * DAY, limit) as any[];
}

const STOP = new Set(('the a an and or to of in on for is it i you we can be with this that how do does my me your are was ' +
  'what when where why there their they have has just so but not no yes please pls would could should will get make ' +
  'like want need any some from at as by if about its im dont cant one more all also too very much really').split(' '));

/** Cheap keyword counts so we can see what people ask about between AI runs. */
export function signalKeywords(days = 7, top = 25) {
  const rows = db.prepare(`SELECT text FROM signals WHERE ts > ?`).all(now() - days * DAY) as { text: string }[];
  const counts = new Map<string, number>();
  for (const { text } of rows) {
    const words = new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top).map(([word, count]) => ({ word, count }));
}

export function trends(key = 'top') {
  const row = db.prepare('SELECT json, ts FROM trends_cache WHERE key = ?').get(key) as { json: string; ts: number } | undefined;
  return row ? { ts: row.ts, data: JSON.parse(row.json) } : null;
}

export function services() {
  return db.prepare(`SELECT * FROM services ORDER BY
    CASE status WHEN 'offline' THEN 0 WHEN 'degraded' THEN 1 WHEN 'unknown' THEN 2 WHEN 'online' THEN 3 ELSE 4 END, kind, name`)
    .all() as any[];
}

/** Words that come up most in real questions (not chatter), so we can see what the knowledge base should cover. */
export function questionKeywords(days = 14, top = 15) {
  const rows = db.prepare(`SELECT text FROM signals WHERE ts > ? AND kind IN ('question', 'request')`).all(now() - days * DAY) as { text: string }[];
  const counts = new Map<string, number>();
  for (const { text } of rows) {
    const words = new Set(text.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w)));
    for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, top).map(([word, count]) => ({ word, count }));
}
