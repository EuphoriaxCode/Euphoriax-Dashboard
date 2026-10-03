import type { FastifyInstance, FastifyRequest } from 'fastify';
import { createWriteStream } from 'node:fs';
import { unlink } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { extname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { removeUser, requireUser, setPassword, userNames } from '../auth.js';
import { config, env } from '../config.js';
import { connectors, collectAll, collectOne } from '../connectors/index.js';
import { buddy, buddyCache, discordLink, refreshBuddy } from '../connectors/buddy.js';
import { trendsApi } from '../connectors/uefnTrends.js';
import { publicSettings, saveSettings } from '../settings.js';
import {
  contentPerformance, latestMetrics, metricHistory, products, recentSales, recentSignals, services, signalKeywords,
  trends, viewsByPlatform,
} from '../data.js';
import { db, logActivity, now } from '../db.js';
import { addJob, moveJob } from '../jobs.js';
import { checkServices, httpServices } from '../monitor.js';
import { PLATFORMS, publish, type PostRow } from '../outgoing/publish.js';
import { analysisRunning, runDailyAnalysis } from '../ai/daily.js';
import { writeCaptions } from '../ai/captions.js';

const who = (req: FastifyRequest) => (req as FastifyRequest & { user: string }).user;
const idParam = (req: FastifyRequest) => Number((req.params as { id: string }).id);

function parseContext(raw: string | null) {
  try { return (JSON.parse(raw ?? '[]') as any[]).slice(-4).map((m) => ({ who: m.authorType ?? m.role ?? m.author ?? '', text: String(m.content ?? m.text ?? '').slice(0, 300) })); }
  catch { return []; }
}

function latestReport() {
  const r = db.prepare(`SELECT * FROM reports WHERE status = 'done' ORDER BY ts DESC LIMIT 1`).get() as any;
  return r ? { ...r, json: JSON.parse(r.json) } : null;
}

export async function dashboardRoutes(app: FastifyInstance) {
  app.addHook('preHandler', requireUser);

  app.get('/api/me', async (req) => ({ user: who(req) }));

  app.get('/api/overview', async () => {
    const svc = services();
    const b = buddyCache();
    return {
      inbox: {
        questions: (b?.unresolved ?? []).slice(0, 8).map((q: any) => ({ ...q, link: discordLink(q), context: parseContext(q.conversationContext) })),
        questionsTotal: b?.unresolved.length ?? 0,
        proposals: (b?.proposals ?? []).slice(0, 5),
        tickets: b?.tickets.length ?? 0,
        failedBuilds: db.prepare(`SELECT id, title, summary FROM jobs WHERE status = 'failed' AND kind = 'build' AND finished_at > ?`).all(now() - 2 * 864e5),
        postsToHandle: db.prepare(`SELECT id, title, status, platforms FROM posts WHERE status IN ('manual', 'failed', 'partial') AND scheduled_at > ?`).all(now() - 7 * 864e5),
      },
      buddyConnected: !!b,
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

  // ---------- Discord (Bot Buddy) ----------
  app.get('/api/discord', async () => {
    const b = buddyCache();
    if (!b) return null;
    return { ...b, unresolved: b.unresolved.map((q: any) => ({ ...q, link: discordLink(q), context: parseContext(q.conversationContext) })) };
  });
  app.post('/api/discord/refresh', async () => { await refreshBuddy(); return { ok: true }; });
  const buddyAction = (path: (id: string) => string, body: (req: FastifyRequest) => unknown, label: string) =>
    async (req: FastifyRequest) => {
      const id = (req.params as { id: string }).id;
      await buddy(path(id), { method: 'POST', body: body(req) });
      logActivity(label, who(req));
      await refreshBuddy().catch(() => {});
      return { ok: true };
    };
  // Answering here makes the right bot persona reply in Discord.
  app.post('/api/discord/unresolved/:id/answer', async (req) => {
    const id = (req.params as { id: string }).id;
    const { answer, remember } = req.body as { answer: string; remember?: boolean };
    await buddy(`/unresolved/${id}/answer`, { method: 'POST', body: { answer, answeredBy: who(req) } });
    // "Remember this" turns the answer into knowledge so the bots answer it themselves next time.
    if (remember) {
      const p = await buddy<any>(`/unresolved/${id}/add-to-knowledge`, { method: 'POST', body: { answer } });
      if (p?.id) await buddy(`/knowledge/proposals/${p.id}/approve`, { method: 'POST', body: { reviewedBy: who(req) } }).catch(() => {});
    }
    logActivity(`Answered a Discord question${remember ? ' (bots will remember it)' : ''}`, who(req));
    await refreshBuddy().catch(() => {});
    return { ok: true };
  });
  app.post('/api/discord/unresolved/:id/ignore', buddyAction((id) => `/unresolved/${id}/ignore`, () => ({}), 'Ignored a Discord question'));
  app.post('/api/discord/proposals/:id/approve', buddyAction((id) => `/knowledge/proposals/${id}/approve`, (req) => ({ reviewedBy: who(req) }), 'Approved bot knowledge'));
  app.post('/api/discord/proposals/:id/reject', buddyAction((id) => `/knowledge/proposals/${id}/reject`, (req) => ({ reviewedBy: who(req) }), 'Rejected bot knowledge'));
  app.post('/api/discord/tickets/:id/close', buddyAction((id) => `/tickets/${id}/close`, (req) => ({ closedBy: who(req) }), 'Closed a Discord ticket'));

  // ---------- UEFN Trends actions ----------
  app.post('/api/trends/run-report', async (req) => {
    await trendsApi('/api/v1/admin/jobs/report:daily/run', { method: 'POST', body: {} });
    logActivity('Asked UEFN Trends for a fresh report', who(req));
    return { ok: true };
  });
  app.post('/api/trends/watch', async (req) => {
    const b = req.body as { kind: string; value: string };
    await trendsApi('/api/v1/watchlist', { method: 'POST', body: { kind: b.kind, value: b.value, note: `added by ${who(req)}` } });
    logActivity(`Added "${b.value}" to the trend watchlist`, who(req));
    return { ok: true };
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
    if (analysisRunning()) return reply.code(409).send({ error: 'An analysis is already running' });
    runDailyAnalysis(who(req)).catch(() => { /* recorded on the report row */ });
    return { started: true, mode: config.aiMode === 'api' && config.anthropicKey ? 'api' : 'machine' };
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
    if (!config.anthropicKey) return reply.code(400).send({ error: 'AI captions need a Claude API key (Setup page)' });
    const body = req.body as { title: string; notes?: string; platforms: string[] };
    return writeCaptions(body);
  });

  // ---------- Build queue ----------
  app.get('/api/jobs', async () => db.prepare(`SELECT id, created_at, created_by, title, position, status, machine, started_at,
    finished_at, summary, attempts, idea_id, kind, substr(prompt, 1, 300) prompt FROM jobs
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
    const job = db.prepare('SELECT kind, report_id FROM jobs WHERE id = ?').get(idParam(req)) as { kind: string; report_id: number | null } | undefined;
    if (job?.kind === 'analysis' && job.report_id) {
      db.prepare(`UPDATE reports SET status = 'failed', error = 'cancelled' WHERE id = ? AND status IN ('queued', 'running')`).run(job.report_id);
    }
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
    fields: publicSettings(env),
    connectors: connectors.map((c) => ({ name: c.name, platform: c.platform, configured: c.configured(), setup: c.setup })),
    ai: { configured: !!config.anthropicKey, mode: config.aiMode, model: config.aiModel, dailyHour: config.dailyHour },
    publisher: { mode: config.publisher, ready: config.publisher === 'manual' || !!(config.ayrshareKey || config.publishWebhook) },
    keys: { ingest: config.ingestKey, machine: config.machineKey },
    urls: {
      publicUrl: config.publicUrl,
      buddyWebhook: `${config.publicUrl}/api/webhooks/buddy`,
      patreonWebhook: `${config.publicUrl}/api/webhooks/patreon`,
    },
    users: userNames(),
    httpServices: httpServices(),
  }));
  app.post('/api/settings', async (req) => {
    saveSettings((req.body as { values: Record<string, string> }).values ?? {});
    logActivity('Changed settings', who(req));
    return { ok: true };
  });
  // "Test" button next to each connection on the Setup page.
  app.post('/api/settings/test', async (req, reply) => {
    const { platform } = req.body as { platform: string };
    const c = connectors.find((x) => x.platform === platform);
    if (!c) return reply.code(404).send({ error: 'unknown connection' });
    await collectOne(c);
    return db.prepare('SELECT status, detail FROM services WHERE name = ?').get(`connector:${platform}`) ?? { status: 'unknown', detail: '' };
  });
  app.post('/api/users', async (req, reply) => {
    const b = req.body as { name: string; password: string };
    if (!b.name?.trim() || (b.password ?? '').length < 8) return reply.code(400).send({ error: 'Name and a password of 8+ characters' });
    setPassword(b.name, b.password);
    logActivity(`Set password for ${b.name.trim().toLowerCase()}`, who(req));
    return { ok: true };
  });
  app.delete('/api/users/:name', async (req, reply) => {
    const name = (req.params as { name: string }).name;
    if (name === who(req)) return reply.code(400).send({ error: 'You cannot remove yourself' });
    removeUser(name);
    return { ok: true };
  });

  // Ready-made start file for the build PC: double-click and it runs.
  app.get('/api/machine-script', async (_req, reply) => {
    const lines = [
      '@echo off',
      'title Euphoriax build PC',
      'REM Double-click to start. Keep this window open; it picks up prompts from the dashboard build queue.',
      `set DASHBOARD_URL=${config.publicUrl}`,
      `set MACHINE_KEY=${config.machineKey}`,
      'set MACHINE_NAME=%COMPUTERNAME%',
      `set WORK_DIR=${config.machineWorkDir || '%~dp0'}`,
      'where node >nul 2>nul || (echo Node.js is missing. Install it from https://nodejs.org and run this again. & pause & exit /b)',
      'where claude >nul 2>nul || (echo Installing Claude Code... & call npm install -g @anthropic-ai/claude-code)',
      ':loop',
      'curl -fsSL -o "%~dp0euphoriax-worker.mjs" "%DASHBOARD_URL%/machine/worker.mjs"',
      'node "%~dp0euphoriax-worker.mjs"',
      'echo Worker stopped, restarting in 10 seconds... & timeout /t 10 >nul',
      'goto loop',
    ];
    reply.header('content-type', 'application/octet-stream');
    reply.header('content-disposition', 'attachment; filename="Start Euphoriax build PC.cmd"');
    return lines.join('\r\n') + '\r\n';
  });
}
