import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { connectors, collectAll } from '../connectors/index.js';
import {
  contentPerformance, latestMetrics, metricHistory, products, recentSales, recentSignals, services, signalKeywords,
  trends, viewsByPlatform,
} from '../data.js';
import { db, logActivity, now } from '../db.js';
import { addJob, moveJob } from '../jobs.js';
import { checkServices, httpServices } from '../monitor.js';
import { PLATFORMS, publish, type PostRow } from '../outgoing/publish.js';
import { runDailyAnalysis } from '../ai/daily.js';
import { writeCaptions } from '../ai/captions.js';

const who = (req: FastifyRequest) => (req as FastifyRequest & { user: string }).user;
const idParam = (req: FastifyRequest) => Number((req.params as { id: string }).id);

function latestReport() {
  const r = db.prepare(`SELECT * FROM reports WHERE status = 'done' ORDER BY ts DESC LIMIT 1`).get() as any;
  return r ? { ...r, json: JSON.parse(r.json) } : null;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/me', async (req) => ({ user: who(req) }));

  app.get('/api/overview', async () => {
    const svc = services();
    return {
      services: svc,
      metrics: latestMetrics(),
      views7d: viewsByPlatform(7),
      views1d: viewsByPlatform(1),
      topContent: contentPerformance({ days: 7, limit: 8 }),
      report: latestReport(),
      lastRun: db.prepare(`SELECT id, ts, status, error FROM reports ORDER BY ts DESC LIMIT 1`).get() ?? null,
      ideas: db.prepare(`SELECT * FROM ideas WHERE status = 'new' ORDER BY ts DESC, score DESC LIMIT 6`).all(),
      jobs: db.prepare(`SELECT id, title, status, machine, started_at, finished_at, summary FROM jobs
        WHERE status IN ('running', 'queued') OR finished_at > ? ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END,
        position, finished_at DESC LIMIT 8`).all(now() - 2 * 864e5),
      posts: db.prepare(`SELECT id, title, platforms, scheduled_at, status FROM posts
        WHERE status IN ('scheduled', 'publishing') OR scheduled_at > ? ORDER BY scheduled_at DESC LIMIT 8`).all(now() - 3 * 864e5),
      products: products().slice(0, 6),
      sales7d: db.prepare(`SELECT COUNT(*) n, COALESCE(SUM(amount_cents), 0) cents FROM sales WHERE ts > ? AND amount_cents > 0`).get(now() - 7 * 864e5),
      keywords: signalKeywords(7, 12),
      signals24h: (db.prepare(`SELECT COUNT(*) n FROM signals WHERE ts > ?`).get(now() - 864e5) as { n: number }).n,
      trends: trends('top'),
      activity: db.prepare(`SELECT * FROM activity ORDER BY ts DESC LIMIT 25`).all(),
    };
  });

  // ---------- Incoming ----------
  app.get('/api/content', async (req) => {
    const q = req.query as { days?: string; platform?: string };
    const days = Number(q.days) || 7;
    return { items: contentPerformance({ days, platform: q.platform ?? '', limit: 200 }), byPlatform: viewsByPlatform(days) };
  });
  app.get('/api/metrics/history', async (req) => {
    const q = req.query as { platform: string; key: string; days?: string };
    return metricHistory(q.platform, q.key, Number(q.days) || 30);
  });
  app.get('/api/sales', async () => ({ products: products(), sales: recentSales(60), metrics: latestMetrics().patreon ?? {} }));
  app.get('/api/signals', async (req) => {
    const q = req.query as { days?: string; kind?: string };
    const days = Number(q.days) || 7;
    const rows = recentSignals(days, 500).filter((s) => !q.kind || s.kind === q.kind);
    return { signals: rows, keywords: signalKeywords(days, 40) };
  });
  app.get('/api/trends', async () => ({ top: trends('top'), latest: trends('latest'), report: trends('report'), status: trends('status') }));

  // ---------- AI ----------
  app.get('/api/reports', async () => db.prepare(`SELECT id, ts, status, summary, error, cost_usd FROM reports ORDER BY ts DESC LIMIT 60`).all());
  app.get('/api/reports/:id', async (req, reply) => {
    const r = db.prepare('SELECT * FROM reports WHERE id = ?').get(idParam(req)) as any;
    if (!r) return reply.code(404).send({ error: 'not found' });
    return { ...r, json: r.json ? JSON.parse(r.json) : null, ideas: db.prepare('SELECT * FROM ideas WHERE report_id = ? ORDER BY score DESC').all(r.id) };
  });
  app.post('/api/reports/run', async (req, reply) => {
    if (!config.anthropicKey) return reply.code(400).send({ error: 'Set ANTHROPIC_API_KEY first' });
    runDailyAnalysis(who(req)).catch(() => { /* recorded on the report row */ });
    return { started: true };
  });
  app.get('/api/ideas', async (req) => {
    const q = req.query as { status?: string };
    return db.prepare(`SELECT * FROM ideas WHERE (? = '' OR status = ?) ORDER BY ts DESC, score DESC LIMIT 200`)
      .all(q.status ?? '', q.status ?? '');
  });
  app.post('/api/ideas/:id', async (req) => {
    const { status } = req.body as { status: string };
    db.prepare('UPDATE ideas SET status = ? WHERE id = ?').run(status, idParam(req));
    return { ok: true };
  });
  app.post('/api/ideas/:id/queue', async (req, reply) => {
    const idea = db.prepare('SELECT * FROM ideas WHERE id = ?').get(idParam(req)) as any;
    if (!idea) return reply.code(404).send({ error: 'not found' });
    const prompt = idea.prompt || `${idea.title}\n\n${idea.why ?? ''}`;
    return { jobId: addJob(idea.title, prompt, who(req), idea.id) };
  });
  app.post('/api/captions', async (req, reply) => {
    if (!config.anthropicKey) return reply.code(400).send({ error: 'Set ANTHROPIC_API_KEY first' });
    const body = req.body as { title: string; notes?: string; platforms: string[] };
    return writeCaptions(body);
  });

  // ---------- Build queue ----------
  app.get('/api/jobs', async () => db.prepare(`SELECT id, created_at, created_by, title, position, status, machine, started_at,
    finished_at, summary, attempts, idea_id, substr(prompt, 1, 300) prompt FROM jobs
    ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 ELSE 2 END, position, finished_at DESC LIMIT 200`).all());
  app.get('/api/jobs/:id', async (req) => db.prepare('SELECT * FROM jobs WHERE id = ?').get(idParam(req)));
  app.post('/api/jobs', async (req, reply) => {
    const b = req.body as { title?: string; prompt?: string; top?: boolean };
    if (!b.prompt?.trim()) return reply.code(400).send({ error: 'prompt required' });
    const title = b.title?.trim() || b.prompt.trim().split('\n')[0].slice(0, 80);
    return { id: addJob(title, b.prompt.trim(), who(req), null, !!b.top) };
  });
  app.post('/api/jobs/:id/move', async (req) => { moveJob(idParam(req), (req.body as { dir: 'up' | 'down' }).dir); return { ok: true }; });
  app.post('/api/jobs/:id/cancel', async (req) => {
    db.prepare(`UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status IN ('queued', 'running')`).run(now(), idParam(req));
    logActivity(`Cancelled build #${idParam(req)}`, who(req));
    return { ok: true };
  });
  app.post('/api/jobs/:id/retry', async (req) => {
    const j = db.prepare('SELECT title, prompt, idea_id FROM jobs WHERE id = ?').get(idParam(req)) as any;
    return { id: addJob(j.title, j.prompt, who(req), j.idea_id) };
  });

  // ---------- Outgoing posts ----------
  app.get('/api/posts', async () => db.prepare('SELECT * FROM posts ORDER BY scheduled_at DESC LIMIT 200').all());
  app.post('/api/posts', async (req, reply) => {
    const fields: Record<string, string> = {};
    let file: { path: string; name: string; size: number } | null = null;
    for await (const part of req.parts()) {
      if (part.type === 'file') {
        const name = `${Date.now()}-${randomBytes(4).toString('hex')}${extname(part.filename).toLowerCase()}`;
        const path = join(config.dataDir, 'uploads', name);
        await pipeline(part.file, createWriteStream(path));
        if (part.file.truncated) { await unlink(path); return reply.code(413).send({ error: 'file too large' }); }
        file = { path, name: part.filename, size: part.file.bytesRead };
      } else {
        fields[part.fieldname] = String(part.value);
      }
    }
    const platforms = (fields.platforms ?? '').split(',').filter((p) => (PLATFORMS as readonly string[]).includes(p));
    if (!fields.title?.trim() || !platforms.length) return reply.code(400).send({ error: 'title and at least one platform required' });
    const scheduledAt = fields.scheduled_at ? Number(fields.scheduled_at) : now();
    const id = Number(db.prepare(`INSERT INTO posts (created_at, created_by, title, caption, captions_json, hashtags, platforms,
      file, file_name, file_size, scheduled_at, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(now(), who(req), fields.title.trim(), fields.caption ?? '', fields.captions_json || null, fields.hashtags ?? '',
        platforms.join(','), file?.path ?? null, file?.name ?? null, file?.size ?? null, scheduledAt,
        fields.draft === '1' ? 'draft' : 'scheduled').lastInsertRowid);
    if (fields.idea_id) db.prepare(`UPDATE ideas SET status = 'posted' WHERE id = ?`).run(Number(fields.idea_id));
    logActivity(`Scheduled "${fields.title.trim()}" for ${platforms.join(', ')}`, who(req));
    return { id };
  });
  app.post('/api/posts/:id/publish', async (req, reply) => {
    const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(idParam(req)) as PostRow | undefined;
    if (!post) return reply.code(404).send({ error: 'not found' });
    await publish(post);
    return db.prepare('SELECT * FROM posts WHERE id = ?').get(post.id);
  });
  app.post('/api/posts/:id/status', async (req) => {
    const { status } = req.body as { status: 'scheduled' | 'draft' | 'published' | 'cancelled' };
    db.prepare('UPDATE posts SET status = ? WHERE id = ?').run(status, idParam(req));
    return { ok: true };
  });

  // ---------- Status & settings ----------
  app.get('/api/services', async () => services());
  app.post('/api/collect', async (req) => {
    logActivity('Manual refresh of all data', who(req));
    await Promise.all([collectAll(), checkServices()]);
    return { ok: true };
  });
  app.get('/api/settings', async () => ({
    connectors: connectors.map((c) => ({ name: c.name, platform: c.platform, configured: c.configured(), setup: c.setup })),
    ai: { configured: !!config.anthropicKey, model: config.aiModel, dailyHour: config.dailyHour },
    publisher: { mode: config.publisher, ready: config.publisher === 'manual' || !!(config.ayrshareKey || config.publishWebhook) },
    notify: !!config.notifyWebhook,
    ingestKey: !!config.ingestKey,
    machineKey: !!config.machineKey,
    httpServices: httpServices(),
    publicUrl: config.publicUrl,
  }));
}
