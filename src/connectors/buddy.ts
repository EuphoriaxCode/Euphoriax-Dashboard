import { config } from '../config.js';
import { db, kvGet, kvSet, now, recordMetric } from '../db.js';
import { setServiceStatus } from '../monitor.js';
import { getJson, toMs, type Connector } from './types.js';

// Discord-Bot-Buddy (github.com/EuphoriaxCode/Discord-Bot-Buddy): the two founder-persona support bots.
// It already has a dashboard API, so we only read from it and forward the buttons we press.

export async function buddy<T = any>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await getJson(`${config.buddy.url}/api/v1${path}`, {
    method: init.method ?? 'GET',
    headers: { authorization: `Bearer ${config.buddy.apiKey}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  if (res && res.ok === false) throw new Error(res.error?.message ?? 'Bot Buddy error');
  return (res?.data ?? res) as T;
}

export interface BuddyCache {
  ts: number;
  status: any;
  personas: any[];
  unresolved: any[];
  tickets: any[];
  proposals: any[];
}

export const buddyCache = () => kvGet<BuddyCache>('buddy_cache') ?? null;

const insertSignal = () => db.prepare(`INSERT OR IGNORE INTO signals (source, kind, author, channel, text, url, ts, ext_id)
  VALUES ('discord', ?, ?, ?, ?, ?, ?, ?)`);

/** Pulls the real questions people asked the bots, so the daily AI knows what the community wants. */
async function importMessages(list: (v: any, key?: string) => any[]) {
  const since = kvGet<number>('buddy_conv_since') ?? now() - 7 * 864e5;
  const convs = list(await buddy('/conversations?limit=50'), 'items');
  const ins = insertSignal();
  let newest = since;
  for (const c of convs) {
    const last = toMs(c.lastActivityAt) ?? 0;
    if (last <= since) continue;
    newest = Math.max(newest, last);
    const msgs = list(await buddy(`/conversations/${c.id}/messages?limit=50`), 'items');
    for (const m of msgs) {
      if (m.authorType !== 'USER' || !m.content?.trim()) continue;
      ins.run(/\?\s*$|^(how|what|why|where|when|can|does|is|do)\b/i.test(m.content.trim()) ? 'question' : 'message',
        m.authorId, c.scope === 'TICKET' ? 'ticket' : c.channelId, m.content.slice(0, 4000), null, toMs(m.createdAt) ?? now(), `buddy:${m.id}`);
    }
  }
  kvSet('buddy_conv_since', newest);
}

export async function refreshBuddy() {
  // Lists come back as arrays; /personas wraps them as { personas, routing }.
  const list = (v: any, key?: string): any[] => (Array.isArray(v) ? v : key && Array.isArray(v?.[key]) ? v[key] : []);
  const [status, personasRes, unresolvedRes, ticketsRes, proposalsRes] = await Promise.all([
    buddy('/status'),
    buddy('/personas').catch(() => null),
    buddy('/unresolved?status=OPEN&limit=100'),
    buddy('/tickets?status=ACTIVE&limit=100'),
    buddy('/knowledge/proposals?status=PENDING&limit=100').catch(() => null),
  ]);
  const personas = list(personasRes, 'personas');
  const unresolved = list(unresolvedRes, 'items');
  const tickets = list(ticketsRes, 'items');
  const proposals = list(proposalsRes, 'items');
  kvSet('buddy_cache', { ts: now(), status, personas, unresolved, tickets, proposals } satisfies BuddyCache);

  // Each bot account becomes its own line on the Status page.
  const nameOf = (id: string) => personas.find((p: any) => p.id === id)?.displayName;
  for (const [key, id] of [['founderA', 'FOUNDER_A'], ['founderB', 'FOUNDER_B']] as const) {
    const b = status.bots?.[key];
    if (!b || b.configured === false) continue; // a bot account that isn't set up isn't "offline"
    setServiceStatus(`buddy:${key}`, 'bot', b.connected ? 'online' : 'offline',
      b.connected ? `connected · ${b.latencyMs ?? '?'} ms` : 'disconnected from Discord', `Discord bot · ${nameOf(id) ?? key}`);
  }
  setServiceStatus('buddy:ai', 'bot', status.ai?.healthy === false ? 'degraded' : 'online',
    `${status.ai?.callsToday ?? 0} AI calls today · $${(status.ai?.estimatedCostToday ?? 0).toFixed(2)}`, 'Bot Buddy AI');

  recordMetric('discord', 'unresolved', unresolved.length);
  recordMetric('discord', 'open_tickets', status.tickets?.open ?? tickets.length);
  recordMetric('discord', 'moderation_today', status.moderationActionsToday);
  recordMetric('discord', 'bot_ai_cost_today', status.ai?.estimatedCostToday);

  // Unanswered questions and tickets are strong "what people want" signals too.
  const ins = insertSignal();
  for (const q of unresolved) ins.run('question', q.username, q.discordChannelId, q.question, discordLink(q), toMs(q.createdAt) ?? now(), `buddy-uq:${q.id}`);
  for (const t of tickets) ins.run('ticket', t.discordUserId, 'ticket', `[${t.category}] ${t.summary ?? 'new ticket'}`, null, toMs(t.createdAt) ?? now(), `buddy-t:${t.id}`);

  await importMessages(list).catch((err) => console.error('buddy message import', err));
  return `${unresolved.length} questions waiting, ${tickets.length} open tickets`;
}

export const discordLink = (q: { discordGuildId?: string; discordChannelId?: string; discordMessageId?: string }) =>
  q.discordGuildId && q.discordChannelId
    ? `https://discord.com/channels/${q.discordGuildId}/${q.discordChannelId}${q.discordMessageId ? `/${q.discordMessageId}` : ''}`
    : null;

export const buddyConnector: Connector = {
  name: 'Discord bots (Bot Buddy)',
  platform: 'buddy',
  setup: 'Bot Buddy address + DASHBOARD_API_KEY on the Setup page',
  configured: () => !!(config.buddy.url && config.buddy.apiKey),
  collect: refreshBuddy,
};
