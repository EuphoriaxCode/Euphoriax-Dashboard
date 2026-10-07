import { createHash, randomBytes } from 'node:crypto';
import { config } from './config.js';
import { db, kvGet, kvSet, now } from './db.js';

/**
 * Visitor stats for euphoriax.net, without cookies or a third-party tracker.
 * The website sends one small beacon per page view to /dashboard/api/site/view (Caddy already proxies /dashboard).
 * No IP addresses are stored: a visitor is a hash of IP + browser with a salt that changes every day,
 * so we can count unique visitors per day but never follow anyone across days.
 */

db.exec(`
CREATE TABLE IF NOT EXISTS site_views (
  ts INTEGER NOT NULL,
  path TEXT NOT NULL,
  visitor TEXT NOT NULL,
  entry INTEGER NOT NULL,          -- 1 = first page of a visit (came from outside the site)
  source TEXT,                     -- Google | YouTube | Direct / unknown | ... (only on entries)
  ref_host TEXT,                   -- e.g. www.google.com (only on entries)
  campaign TEXT,                   -- ?utm_source= / ?ref= value (only on entries)
  device TEXT,                     -- Mobile | Desktop
  tz TEXT                          -- browser time zone, e.g. Europe/Brussels: a rough "where from" without GeoIP
);
CREATE INDEX IF NOT EXISTS site_views_ts ON site_views (ts);
`);

const DAY = 864e5;
const BOT = /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|monitor/i;

/** First match wins, so the specific ones (Gemini, YouTube app) come before the general Google rule. */
const SOURCES: [RegExp, string][] = [
  [/(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|claude\.ai|gemini\.google\.com|copilot\.microsoft\.com)$/, 'AI chat (ChatGPT, …)'],
  [/(^|\.)(youtube\.com|youtu\.be)$|android\.youtube/, 'YouTube'],
  [/(^|\.)google\.[a-z.]+$|googlequicksearchbox/, 'Google'],
  [/(^|\.)(bing\.com|duckduckgo\.com|yahoo\.com|ecosia\.org|search\.brave\.com|yandex\.[a-z]+|baidu\.com|qwant\.com|startpage\.com)$/, 'Other search engines'],
  [/(^|\.)(discord\.com|discordapp\.com|discord\.gg)$/, 'Discord'],
  [/(^|\.)tiktok\.com$/, 'TikTok'],
  [/(^|\.)(t\.co|twitter\.com|x\.com)$/, 'X'],
  [/(^|\.)instagram\.com$/, 'Instagram'],
  [/(^|\.)(facebook\.com|fb\.com|messenger\.com)$/, 'Facebook'],
  [/(^|\.)reddit\.com$/, 'Reddit'],
  [/(^|\.)patreon\.com$/, 'Patreon'],
  [/(^|\.)(fortnite\.com|epicgames\.com)$/, 'Fortnite / Epic'],
  [/^(mail\.google\.com|outlook\.live\.com|outlook\.office\.com)$|android\.gm$/, 'Email'],
];

/** ?utm_source=yt or ?ref=discord: the same names as the referrer sources where possible. */
const CAMPAIGN_ALIASES: [RegExp, string][] = [
  [/^(yt|youtube)/, 'YouTube'], [/^(dc|discord)/, 'Discord'], [/^(tt|tiktok)/, 'TikTok'], [/^(x|twitter)$/, 'X'],
  [/^(ig|insta)/, 'Instagram'], [/^patreon/, 'Patreon'], [/^(google|gads)/, 'Google'], [/^reddit/, 'Reddit'], [/^(mail|email|newsletter)/, 'Email'],
];

function ownHosts() {
  const host = (() => { try { return new URL(config.publicUrl).hostname; } catch { return ''; } })();
  const bare = host.replace(/^www\./, '');
  return new Set([bare, `www.${bare}`, 'localhost', '127.0.0.1'].filter(Boolean));
}

export function classify(refHost: string, campaign: string) {
  const c = campaign.toLowerCase();
  if (c) return CAMPAIGN_ALIASES.find(([re]) => re.test(c))?.[1] ?? `Link: ${campaign}`;
  if (!refHost) return 'Direct / unknown';
  return SOURCES.find(([re]) => re.test(refHost))?.[1] ?? 'Other websites';
}

function dailySalt() {
  const day = new Date().toISOString().slice(0, 10);
  const s = kvGet<{ day: string; salt: string }>('site_salt');
  if (s?.day === day) return s.salt;
  const salt = randomBytes(16).toString('hex');
  kvSet('site_salt', { day, salt });
  return salt;
}

// A beacon per page view is a handful per minute per real person; more than this from one IP is a script.
const recent = new Map<string, { n: number; t: number }>();
function tooMany(ip: string) {
  const t = now();
  const r = recent.get(ip);
  if (!r || t - r.t > 60_000) { recent.set(ip, { n: 1, t }); if (recent.size > 5000) recent.clear(); return false; }
  return ++r.n > 30;
}

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.slice(0, n).trim() : '');

export interface ViewBeacon { p?: string; r?: string; c?: string; tz?: string }

/** Returns false when the hit was ignored (bot, other site, flood); the caller answers 204 either way. */
export function recordView(b: ViewBeacon, ip: string, ua: string, origin: string | undefined) {
  if (!ua || BOT.test(ua) || tooMany(ip)) return false;
  const own = ownHosts();
  if (origin) { try { if (!own.has(new URL(origin).hostname)) return false; } catch { return false; } }

  const path = clip(b.p, 300).split(/[?#]/)[0];
  if (!path.startsWith('/') || path.startsWith('/dashboard')) return false;
  let refHost = '';
  try { refHost = b.r ? new URL(clip(b.r, 500)).hostname.toLowerCase() : ''; } catch { /* not a URL */ }
  const entry = !own.has(refHost);
  const campaign = entry ? clip(b.c, 60).replace(/[^\w.\- ]/g, '') : '';

  db.prepare(`INSERT INTO site_views (ts, path, visitor, entry, source, ref_host, campaign, device, tz) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    now(), path,
    createHash('sha256').update(`${dailySalt()}|${ip}|${ua}`).digest('hex').slice(0, 16),
    entry ? 1 : 0,
    entry ? classify(refHost, campaign) : null,
    entry ? refHost || null : null,
    campaign || null,
    /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'Mobile' : 'Desktop',
    clip(b.tz, 60) || null,
  );
  return true;
}

export function pruneSiteViews() {
  db.prepare('DELETE FROM site_views WHERE ts < ?').run(now() - 400 * DAY);
}

export function websiteStats(days: number) {
  const t = now();
  const since = t - days * DAY;
  const one = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).get(...args) as T;
  const all = <T>(sql: string, ...args: (number | string)[]) => db.prepare(sql).all(...args) as T[];
  const totals = (from: number, to: number) => one<{ visitors: number; visits: number; views: number }>(
    `SELECT COUNT(DISTINCT visitor) visitors, COALESCE(SUM(entry), 0) visits, COUNT(*) views FROM site_views WHERE ts > ? AND ts <= ?`, from, to);

  return {
    days,
    lastView: one<{ ts: number | null }>('SELECT MAX(ts) ts FROM site_views').ts,
    liveNow: one<{ n: number }>('SELECT COUNT(DISTINCT visitor) n FROM site_views WHERE ts > ?', t - 30 * 60_000).n,
    totals: totals(since, t),
    previous: totals(since - days * DAY, since),
    // Days in UTC; one row per day that had views.
    daily: all<{ day: string; visitors: number; views: number }>(
      `SELECT date(ts / 1000, 'unixepoch') day, COUNT(DISTINCT visitor) visitors, COUNT(*) views FROM site_views WHERE ts > ? GROUP BY day ORDER BY day`, since),
    sources: all<{ source: string; visits: number; visitors: number }>(
      `SELECT source, COUNT(*) visits, COUNT(DISTINCT visitor) visitors FROM site_views WHERE entry = 1 AND ts > ? GROUP BY source ORDER BY visits DESC`, since),
    referrers: all<{ host: string; source: string; visits: number }>(
      `SELECT ref_host host, source, COUNT(*) visits FROM site_views WHERE entry = 1 AND ref_host IS NOT NULL AND ts > ? GROUP BY ref_host ORDER BY visits DESC LIMIT 20`, since),
    campaigns: all<{ campaign: string; visits: number }>(
      `SELECT campaign, COUNT(*) visits FROM site_views WHERE entry = 1 AND campaign IS NOT NULL AND ts > ? GROUP BY campaign ORDER BY visits DESC LIMIT 15`, since),
    pages: all<{ path: string; views: number; visitors: number; entries: number }>(
      `SELECT path, COUNT(*) views, COUNT(DISTINCT visitor) visitors, SUM(entry) entries FROM site_views WHERE ts > ? GROUP BY path ORDER BY views DESC LIMIT 30`, since),
    devices: all<{ device: string; visitors: number }>(
      `SELECT device, COUNT(DISTINCT visitor) visitors FROM site_views WHERE ts > ? GROUP BY device ORDER BY visitors DESC`, since),
    regions: all<{ tz: string; visitors: number }>(
      `SELECT COALESCE(tz, 'unknown') tz, COUNT(DISTINCT visitor) visitors FROM site_views WHERE ts > ? GROUP BY tz ORDER BY visitors DESC LIMIT 12`, since),
  };
}
