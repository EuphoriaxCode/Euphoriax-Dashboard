import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireKey } from '../auth.js';
import { config } from '../config.js';
import { db, logActivity, now, recordMetric } from '../db.js';
import { appendLog, claimNext, finishJob } from '../jobs.js';
import { parseKnowledgeText, suggestKeywords } from '../knowledgeParse.js';
import { notify } from '../notify.js';
import { heartbeat, type Status } from '../monitor.js';

const idParam = (req: FastifyRequest) => Number((req.params as { id: string }).id);

/** Endpoints our bots, the Discord tools and the UEFN build machine call with an API key. */
export async function machineRoutes(app: FastifyInstance) {
  // ----- Bots / services (INGEST_KEY) -----
  app.register(async (ingest) => {
    ingest.addHook('preHandler', requireKey('ingestKey'));

    ingest.post('/api/ingest/heartbeat', async (req) => {
      const b = req.body as { name: string; status?: Status; detail?: string };
      heartbeat(b.name, b.status ?? 'online', b.detail ?? '');
      return { ok: true };
    });

    // Discord tools post what people ask/request: one object or an array.
    ingest.post('/api/ingest/signal', async (req) => {
      const items = ([] as any[]).concat(req.body);
      const ins = db.prepare('INSERT INTO signals (source, kind, author, channel, text, url, ts) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const s of items) {
        if (!s?.text) continue;
        ins.run(s.source ?? 'discord', s.kind ?? 'message', s.author ?? null, s.channel ?? null, String(s.text).slice(0, 4000),
          s.url ?? null, s.ts ? Number(s.ts) : now());
      }
      return { ok: true, count: items.length };
    });

    // For sales outside Patreon's API (shop, Gumroad, manual entries).
    ingest.post('/api/ingest/sale', async (req) => {
      const s = req.body as { platform?: string; product: string; amount_cents: number; event?: string; customer?: string; ts?: number };
      db.prepare('INSERT INTO sales (platform, product, amount_cents, event, customer, ts) VALUES (?, ?, ?, ?, ?, ?)')
        .run(s.platform ?? 'manual', s.product, s.amount_cents, s.event ?? 'sale', s.customer ?? null, s.ts ?? now());
      return { ok: true };
    });

    // Q&As for the Discord bots. Body = text in the V:/O:/C:/A: format (text/plain) or { text } or { items: [...] }.
    // They land as drafts on the Knowledge page and only go live after we approve them.
    ingest.post('/api/ingest/knowledge', async (req, reply) => {
      const body = req.body as unknown;
      const text = typeof body === 'string' ? body : typeof (body as { text?: string })?.text === 'string' ? (body as { text: string }).text : '';
      const given = Array.isArray((body as { items?: unknown[] })?.items) ? (body as { items: Record<string, unknown>[] }).items : [];
      const items = [
        ...parseKnowledgeText(text),
        ...given.map((i) => ({
          question: String(i.question ?? '').trim().slice(0, 500), answer: String(i.answer ?? '').trim().slice(0, 1900),
          aliases: ([] as unknown[]).concat(i.aliases ?? []).map(String).filter(Boolean),
          keywords: ([] as unknown[]).concat(i.keywords ?? []).map(String).filter(Boolean),
          category: i.category ? String(i.category).slice(0, 60) : undefined,
        })).filter((i) => i.question.length >= 3 && i.answer),
      ].slice(0, 300);
      if (!items.length) return reply.code(400).send({ error: 'No entries found. Use "V: question" and "A: answer" blocks separated by a blank line.' });
      const ins = db.prepare('INSERT INTO kb_drafts (created_at, source, question, answer, aliases, keywords, category) VALUES (?, ?, ?, ?, ?, ?, ?)');
      for (const i of items) ins.run(now(), 'push', i.question, i.answer, JSON.stringify(i.aliases), JSON.stringify(i.keywords.length ? i.keywords : suggestKeywords(i.question)), i.category ?? null);
      logActivity(`${items.length} bot answers waiting for review`, 'push');
      void notify(`📚 **${items.length} new answers for the Discord bots** are waiting for your review: ${config.publicUrl}/#knowledge`);
      return { ok: true, added: items.length, review: `${config.publicUrl}/#knowledge` };
    });

    ingest.post('/api/ingest/metric', async (req) => {
      const m = req.body as { platform: string; key: string; value: number };
      recordMetric(m.platform, m.key, m.value);
      return { ok: true };
    });
  });

  // ----- Patreon webhooks (signed with PATREON_WEBHOOK_SECRET, HMAC-MD5 over the raw body) -----
  app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hooks.post('/api/webhooks/patreon', async (req, reply) => {
      const raw = req.body as Buffer;
      const sig = String(req.headers['x-patreon-signature'] ?? '');
      const { createHmac } = await import('node:crypto');
      const expected = createHmac('md5', config.patreon.webhookSecret).update(raw).digest('hex');
      if (!config.patreon.webhookSecret || sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
        return reply.code(401).send({ error: 'bad signature' });
      }
      const event = String(req.headers['x-patreon-event'] ?? 'unknown');
      const body = JSON.parse(raw.toString());
      const a = body.data?.attributes ?? {};
      const tierId = body.data?.relationships?.currently_entitled_tiers?.data?.[0]?.id;
      const tier = (body.included ?? []).find((i: any) => i.type === 'tier' && i.id === tierId);
      const customer = createHash('sha256').update(String(a.email ?? a.full_name ?? '')).digest('hex').slice(0, 10);
      db.prepare('INSERT INTO sales (platform, product, amount_cents, event, customer, ts) VALUES (?, ?, ?, ?, ?, ?)')
        .run('patreon', tier?.attributes?.title ?? 'membership', event.includes('delete') ? 0 : a.currently_entitled_amount_cents ?? 0,
          event, customer, now());
      logActivity(`Patreon: ${event} (${tier?.attributes?.title ?? 'membership'})`);
      return { ok: true };
    });
  });

  // ----- Discord-Bot-Buddy webhooks: instant refresh + pings (HMAC-SHA256 over "<timestamp>.<raw body>") -----
  app.register(async (hooks) => {
    hooks.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
    hooks.post('/api/webhooks/buddy', async (req, reply) => {
      const raw = req.body as Buffer;
      const secret = config.buddy.webhookSecret;
      const ts = String(req.headers['x-webhook-timestamp'] ?? '');
      const given = String(req.headers['x-webhook-signature'] ?? '');
      const { createHmac } = await import('node:crypto');
      const expected = 'sha256=' + createHmac('sha256', secret).update(`${ts}.${raw.toString()}`).digest('hex');
      if (!secret || Math.abs(Date.now() / 1000 - Number(ts)) > 300 || given.length !== expected.length
        || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) {
        return reply.code(401).send({ error: 'bad signature' });
      }
      const evt = JSON.parse(raw.toString());
      const { refreshBuddy } = await import('../connectors/buddy.js');
      const { notify } = await import('../notify.js');
      if (evt.event === 'question.unresolved') {
        await notify(`❓ **A Discord question needs you**: "${String(evt.data?.question ?? '').slice(0, 300)}"\nAnswer it on ${config.publicUrl}/#overview`);
      } else if (evt.event === 'ticket.created') {
        await notify(`🎫 New Discord ticket${evt.data?.category ? ` (${evt.data.category})` : ''}`);
      }
      if (/^(question|ticket|knowledge|discord|system)\./.test(evt.event)) {
        refreshBuddy().catch((err) => console.error('buddy refresh', err));
        logActivity(`Discord: ${evt.event.replace('.', ' ').replace(/_/g, ' ')}`, 'bot buddy');
      }
      return { ok: true };
    });
  });

  // ----- UEFN build machine (MACHINE_KEY) -----
  app.register(async (m) => {
    m.addHook('preHandler', requireKey('machineKey'));

    m.post('/api/machine/heartbeat', async (req) => {
      const b = req.body as { name: string; busy?: boolean; detail?: string };
      heartbeat(b.name, 'online', b.detail ?? (b.busy ? 'building' : 'idle'), 'machine');
      return { ok: true };
    });
    m.post('/api/machine/claim', async (req, reply) => {
      const { name } = req.body as { name: string };
      heartbeat(name, 'online', 'claiming', 'machine');
      const job = claimNext(name);
      return job ? { id: job.id, title: job.title, prompt: job.prompt, kind: job.kind } : reply.code(204).send();
    });
    m.post('/api/machine/jobs/:id/log', async (req) => appendLog(idParam(req), (req.body as { chunk: string }).chunk ?? ''));
    m.post('/api/machine/jobs/:id/finish', async (req) => {
      const b = req.body as { status: 'done' | 'failed' | 'requeue'; summary?: string; output?: string };
      await finishJob(idParam(req), b.status, b.summary ?? '', b.output ?? '');
      return { ok: true };
    });
  });

  if (!config.ingestKey) logActivity('INGEST_KEY is not set - bots cannot send heartbeats or Discord data yet');
}
