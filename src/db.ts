import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './config.js';

mkdirSync(join(config.dataDir, 'uploads'), { recursive: true });

export const db = new DatabaseSync(join(config.dataDir, 'dashboard.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT NOT NULL);

-- Everything that can be "online" or "offline": bots, connectors, the build machine, websites.
CREATE TABLE IF NOT EXISTS services (
  name TEXT PRIMARY KEY,
  label TEXT,
  kind TEXT NOT NULL,              -- heartbeat | http | connector | machine
  url TEXT,
  status TEXT NOT NULL DEFAULT 'unknown', -- online | degraded | offline | unknown | not_configured
  detail TEXT,
  last_seen INTEGER,
  last_check INTEGER,
  changed_at INTEGER
);

-- Account-level numbers over time (followers, patrons, members, revenue...).
CREATE TABLE IF NOT EXISTS metrics (
  platform TEXT NOT NULL, key TEXT NOT NULL, value REAL NOT NULL, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS metrics_idx ON metrics (platform, key, ts);

-- One row per video/post/tweet across platforms, with latest stats.
CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,             -- platform:nativeId
  platform TEXT NOT NULL,
  title TEXT, url TEXT, thumbnail TEXT,
  published_at INTEGER,
  views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, comments INTEGER DEFAULT 0, shares INTEGER DEFAULT 0,
  updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS content_snapshots (
  content_id TEXT NOT NULL, ts INTEGER NOT NULL, views INTEGER, likes INTEGER
);
CREATE INDEX IF NOT EXISTS content_snap_idx ON content_snapshots (content_id, ts);

-- Patreon tiers / products and individual sales events.
CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL,
  price_cents INTEGER, members INTEGER DEFAULT 0, revenue_cents INTEGER DEFAULT 0, updated_at INTEGER
);
CREATE TABLE IF NOT EXISTS sales (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL, product TEXT, amount_cents INTEGER, event TEXT, customer TEXT, ts INTEGER NOT NULL
);

-- What the community says: Discord requests/questions/feedback.
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL, kind TEXT NOT NULL, author TEXT, channel TEXT, text TEXT NOT NULL,
  url TEXT, ts INTEGER NOT NULL, ext_id TEXT
);
CREATE INDEX IF NOT EXISTS signals_ts ON signals (ts);

-- UEFN Trends snapshot (whole JSON, latest wins).
CREATE TABLE IF NOT EXISTS trends_cache (key TEXT PRIMARY KEY, json TEXT NOT NULL, ts INTEGER NOT NULL);

-- Daily AI reports and the ideas they produce.
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL, status TEXT NOT NULL, summary TEXT, json TEXT, error TEXT, cost_usd REAL
);
CREATE TABLE IF NOT EXISTS ideas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER, ts INTEGER NOT NULL,
  type TEXT NOT NULL,              -- system | video | product
  title TEXT NOT NULL, why TEXT, prompt TEXT, caption TEXT, score INTEGER,
  status TEXT NOT NULL DEFAULT 'new' -- new | queued | posted | dismissed
);

-- Outgoing posts (one video -> many platforms).
CREATE TABLE IF NOT EXISTS posts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL, created_by TEXT,
  title TEXT NOT NULL, caption TEXT, captions_json TEXT, hashtags TEXT,
  platforms TEXT NOT NULL,         -- comma separated
  file TEXT, file_name TEXT, file_size INTEGER,
  scheduled_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'scheduled', -- draft | scheduled | publishing | published | partial | failed
  results_json TEXT, error TEXT
);

-- Build queue for the UEFN machine.
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at INTEGER NOT NULL, created_by TEXT,
  title TEXT NOT NULL, prompt TEXT NOT NULL,
  position REAL NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued', -- queued | running | done | failed | cancelled
  machine TEXT, started_at INTEGER, finished_at INTEGER,
  summary TEXT, log TEXT NOT NULL DEFAULT '', idea_id INTEGER, attempts INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'build', report_id INTEGER
);

-- Q&As pushed in by tools (e.g. Codex); they wait here until we approve them.
CREATE TABLE IF NOT EXISTS kb_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT, created_at INTEGER NOT NULL, source TEXT,
  question TEXT NOT NULL, answer TEXT NOT NULL, aliases TEXT NOT NULL DEFAULT '[]', keywords TEXT NOT NULL DEFAULT '[]', category TEXT
);

CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, who TEXT, text TEXT NOT NULL
);
`);

// Columns added after v1: add them to older databases.
for (const sql of [
  'ALTER TABLE signals ADD COLUMN ext_id TEXT',
  "ALTER TABLE jobs ADD COLUMN kind TEXT NOT NULL DEFAULT 'build'",
  'ALTER TABLE jobs ADD COLUMN report_id INTEGER',
  'ALTER TABLE sales ADD COLUMN ext_id TEXT',
]) {
  try { db.exec(sql); } catch { /* already there */ }
}
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS signals_ext ON signals (ext_id)');
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS sales_ext ON sales (ext_id)');   // imported sales are never counted twice

export const now = () => Date.now();

export function kvGet<T>(key: string): T | undefined {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key) as { value: string } | undefined;
  return row ? (JSON.parse(row.value) as T) : undefined;
}
export function kvSet(key: string, value: unknown) {
  db.prepare('INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, JSON.stringify(value));
}

export function logActivity(text: string, who = 'system') {
  db.prepare('INSERT INTO activity (ts, who, text) VALUES (?, ?, ?)').run(now(), who, text);
}

export function recordMetric(platform: string, key: string, value: number | undefined | null, ts = now()) {
  if (value === undefined || value === null || Number.isNaN(value)) return;
  db.prepare('INSERT INTO metrics (platform, key, value, ts) VALUES (?, ?, ?, ?)').run(platform, key, value, ts);
}

export interface ContentInput {
  platform: string; nativeId: string; title?: string; url?: string; thumbnail?: string;
  publishedAt?: number; views?: number; likes?: number; comments?: number; shares?: number;
}

export function upsertContent(c: ContentInput, ts = now()) {
  const id = `${c.platform}:${c.nativeId}`;
  db.prepare(`
    INSERT INTO content (id, platform, title, url, thumbnail, published_at, views, likes, comments, shares, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET title = excluded.title, url = excluded.url, thumbnail = excluded.thumbnail,
      views = excluded.views, likes = excluded.likes, comments = excluded.comments, shares = excluded.shares,
      updated_at = excluded.updated_at`)
    .run(id, c.platform, c.title ?? '', c.url ?? '', c.thumbnail ?? '', c.publishedAt ?? null,
      c.views ?? 0, c.likes ?? 0, c.comments ?? 0, c.shares ?? 0, ts);
  db.prepare('INSERT INTO content_snapshots (content_id, ts, views, likes) VALUES (?, ?, ?, ?)')
    .run(id, ts, c.views ?? 0, c.likes ?? 0);
}
