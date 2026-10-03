import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  COOKIE, checkLogin, checkMediaSig, cookieOptions, createSession, loginAllowed, loginFailed, needsFirstAccount, sessionUser, setPassword,
} from './auth.js';
import { loadSettings, saveSettings } from './settings.js';
import { env } from './config.js';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { db, logActivity } from './db.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { machineRoutes } from './routes/machines.js';
import { startScheduler } from './scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

loadSettings();

/** The first login tells us the dashboard's real address, so nobody has to type it in. */
function rememberPublicUrl(req: FastifyRequest) {
  if (env('PUBLIC_URL')) return;
  const host = (req.headers['x-forwarded-host'] as string) || req.headers.host;
  if (!host || /^(localhost|127\.)/.test(host)) return;
  const proto = ((req.headers['x-forwarded-proto'] as string) || req.protocol || 'https').split(',')[0];
  saveSettings({ PUBLIC_URL: `${proto}://${host}${config.basePath}` });
}

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
// The page shows `error` as-is, so always send a readable message (not "Internal Server Error").
app.setErrorHandler((error, req, reply) => {
  const err = error as { statusCode?: number; message?: string };
  const status = err.statusCode && err.statusCode < 500 ? err.statusCode : 500;
  if (status === 500) req.log.error(error);
  reply.code(status).send({ error: err.message || 'Something went wrong' });
});
await app.register(cookie);
await app.register(multipart, { limits: { fileSize: 4 * 1024 ** 3, files: 1 } });

await app.register(async (root) => {
  root.addHook('onSend', async (_req, reply) => {
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    reply.header('x-robots-tag', 'noindex, nofollow');
  });

  await root.register(fastifyStatic, { root: publicDir, prefix: '/' });

  root.get('/health', async () => ({ ok: true }));

  // First visit: no accounts yet, so the page asks you to create them.
  root.get('/api/setup-state', async () => ({ needsAccount: needsFirstAccount() }));
  root.post('/api/first-account', async (req, reply) => {
    if (!needsFirstAccount()) return reply.code(403).send({ error: 'Accounts already exist' });
    const b = (req.body ?? {}) as { name?: string; password?: string; name2?: string; password2?: string };
    if (!b.name?.trim() || (b.password ?? '').length < 8) return reply.code(400).send({ error: 'Pick a name and a password of 8+ characters' });
    if (b.name2?.trim() && (b.password2 ?? '').length < 8) return reply.code(400).send({ error: 'The second password needs 8+ characters too' });
    rememberPublicUrl(req);
    setPassword(b.name, b.password!);
    if (b.name2?.trim()) setPassword(b.name2, b.password2!);
    const user = b.name.trim().toLowerCase();
    logActivity('Created the dashboard accounts', user);
    return reply.setCookie(COOKIE, createSession(user), cookieOptions()).send({ user });
  });

  // The build PC downloads the latest worker from here on every start.
  root.get('/machine/worker.mjs', async (_req, reply) => {
    reply.header('content-type', 'text/javascript; charset=utf-8');
    return reply.send(createReadStream(join(here, '..', 'machine', 'worker.mjs')));
  });

  root.post('/api/login', async (req, reply) => {
    const { name = '', password = '' } = (req.body ?? {}) as { name?: string; password?: string };
    if (!loginAllowed(req.ip)) return reply.code(429).send({ error: 'Too many attempts, wait 15 minutes' });
    const user = checkLogin(name, password);
    if (!user) { loginFailed(req.ip); return reply.code(401).send({ error: 'Wrong name or password' }); }
    logActivity('Logged in', user);
    rememberPublicUrl(req);
    return reply.setCookie(COOKIE, createSession(user), cookieOptions()).send({ user });
  });
  root.post('/api/logout', async (_req, reply) => reply.clearCookie(COOKIE, { path: cookieOptions().path }).send({ ok: true }));

  // Uploaded videos: viewable when logged in, or via a signed link for the publisher.
  root.get('/media/:id', async (req, reply) => {
    const id = Number((req.params as { id: string }).id);
    const q = req.query as { exp?: string; sig?: string };
    if (!sessionUser(req) && !checkMediaSig(id, Number(q.exp), q.sig ?? '')) return reply.code(401).send({ error: 'unauthorized' });
    const post = db.prepare('SELECT file, file_name FROM posts WHERE id = ?').get(id) as { file: string; file_name: string } | undefined;
    if (!post?.file || !existsSync(post.file)) return reply.code(404).send({ error: 'not found' });
    const ext = post.file.split('.').pop()?.toLowerCase();
    reply.header('content-type', ext === 'mov' ? 'video/quicktime' : ext === 'webm' ? 'video/webm' : 'video/mp4');
    reply.header('content-length', statSync(post.file).size);
    return reply.send(createReadStream(post.file));
  });

  await root.register(machineRoutes);
  await root.register(dashboardRoutes);
}, { prefix: config.basePath || '' });

// "/dashboard" → "/dashboard/" so the page's relative links resolve.
if (config.basePath) app.get(config.basePath, async (_req, reply) => reply.redirect(`${config.basePath}/`));

startScheduler();
await app.listen({ port: config.port, host: config.host });
console.log(`Euphoriax dashboard on http://localhost:${config.port}${config.basePath}/`);
if (needsFirstAccount()) console.log('No accounts yet: open the dashboard in your browser to create them.');
