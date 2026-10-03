import { db, logActivity, now } from '../db.js';
import { buddyConnector } from './buddy.js';
import { discord } from './discord.js';
import { instagram } from './instagram.js';
import { patreon } from './patreon.js';
import { tiktok } from './tiktok.js';
import { twitter } from './twitter.js';
import type { Connector } from './types.js';
import { uefnTrends } from './uefnTrends.js';
import { youtube } from './youtube.js';
import { setServiceStatus } from '../monitor.js';

export const connectors: Connector[] = [buddyConnector, uefnTrends, youtube, tiktok, instagram, twitter, patreon, discord];

export async function collectAll() {
  await Promise.all(connectors.map(collectOne));
  // Keep snapshots for 90 days; that's plenty for growth charts.
  db.prepare('DELETE FROM content_snapshots WHERE ts < ?').run(now() - 90 * 864e5);
}

export async function collectOne(c: Connector) {
  const svc = `connector:${c.platform}`;
  if (!c.configured()) {
    setServiceStatus(svc, 'connector', 'not_configured', `Set ${c.setup}`, c.name);
    return;
  }
  try {
    const detail = await c.collect();
    setServiceStatus(svc, 'connector', 'online', detail, c.name);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    setServiceStatus(svc, 'connector', 'offline', msg.slice(0, 300), c.name);
    logActivity(`${c.name} collection failed: ${msg.slice(0, 120)}`);
  }
}
