import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { requireKey } from '../auth.js';
import { config } from '../config.js';
import { db, logActivity, now, recordMetric } from '../db.js';
import { appendLog, claimNext, finishJob } from '../jobs.js';
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
      return job ? { id: job.id, title: job.title, prompt: job.prompt } : reply.code(204).send();
    });
    m.post('/api/machine/jobs/:id/log', async (req) => appendLog(idParam(req), (req.body as { chunk: string }).chunk ?? ''));
    m.post('/api/machine/jobs/:id/finish', async (req) => {
      const b = req.body as { status: 'done' | 'failed' | 'requeue'; summary?: string };
      finishJob(idParam(req), b.status, b.summary ?? '');
      return { ok: true };
    });
  });

  if (!config.ingestKey) logActivity('INGEST_KEY is not set - bots cannot send heartbeats or Discord data yet');
}
