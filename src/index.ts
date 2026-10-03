import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import fastifyStatic from '@fastify/static';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { COOKIE, checkLogin, checkMediaSig, cookieOptions, createSession, loginAllowed, loginFailed, sessionUser } from './auth.js';
import { config } from './config.js';
import { db, logActivity } from './db.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { machineRoutes } from './routes/machines.js';
import { startScheduler } from './scheduler.js';

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

if (config.production && config.sessionSecret === 'dev-only-change-me') {
  throw new Error('Set SESSION_SECRET in production');
}

const app = Fastify({ logger: { level: 'warn' }, trustProxy: true, bodyLimit: 2 * 1024 * 1024 });
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

  root.post('/api/login', async (req, reply) => {
    const { name = '', password = '' } = (req.body ?? {}) as { name?: string; password?: string };
    if (!loginAllowed(req.ip)) return reply.code(429).send({ error: 'Too many attempts, wait 15 minutes' });
    const user = checkLogin(name, password);
    if (!user) { loginFailed(req.ip); return reply.code(401).send({ error: 'Wrong name or password' }); }
    logActivity('Logged in', user);
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

startScheduler();
await app.listen({ port: config.port, host: config.host });
console.log(`Euphoriax dashboard on http://localhost:${config.port}${config.basePath}/`);
if (!config.users) console.warn('DASHBOARD_USERS is empty - nobody can log in. Run `npm run hash-password`.');
