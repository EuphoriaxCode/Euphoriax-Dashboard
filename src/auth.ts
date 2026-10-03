import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { config } from './config.js';

const SESSION_DAYS = 14;
export const COOKIE = 'eux_session';

export function hashPassword(password: string) {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password: string, stored: string) {
  const [, salt, hash] = stored.split('$');
  if (!salt || !hash) return false;
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(password, salt, a.length);
  return a.length === b.length && timingSafeEqual(a, b);
}

function users() {
  const map = new Map<string, string>();
  for (const entry of config.users.split(',')) {
    const i = entry.indexOf(':');
    if (i > 0) map.set(entry.slice(0, i).trim().toLowerCase(), entry.slice(i + 1).trim());
  }
  return map;
}

export function checkLogin(name: string, password: string): string | null {
  const stored = users().get(name.trim().toLowerCase());
  return stored && verifyPassword(password, stored) ? name.trim().toLowerCase() : null;
}

const sign = (data: string) => createHmac('sha256', config.sessionSecret).update(data).digest('base64url');

export function createSession(user: string) {
  const payload = Buffer.from(JSON.stringify({ u: user, exp: Date.now() + SESSION_DAYS * 864e5 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}

export function readSession(token: string | undefined): string | null {
  if (!token) return null;
  const [payload, sig] = token.split('.');
  if (!payload || !sig) return null;
  const expected = sign(payload);
  if (sig.length !== expected.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, 'base64url').toString());
    return exp > Date.now() && users().has(u) ? u : null;
  } catch {
    return null;
  }
}

export const cookieOptions = () => ({
  path: config.basePath || '/',
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: config.production,
  maxAge: SESSION_DAYS * 86400,
});

export function sessionUser(req: FastifyRequest) {
  return readSession(req.cookies[COOKIE]);
}

export async function requireUser(req: FastifyRequest, reply: FastifyReply) {
  const user = sessionUser(req);
  if (!user) return reply.code(401).send({ error: 'login required' });
  (req as FastifyRequest & { user: string }).user = user;
}

function keyMatches(req: FastifyRequest, key: string) {
  if (!key) return false;
  const given = (req.headers['x-api-key'] as string) || req.headers.authorization?.replace(/^Bearer\s+/i, '') || '';
  return given.length === key.length && timingSafeEqual(Buffer.from(given), Buffer.from(key));
}

export const requireKey = (which: 'ingestKey' | 'machineKey') =>
  async (req: FastifyRequest, reply: FastifyReply) => {
    if (!keyMatches(req, config[which])) return reply.code(401).send({ error: 'bad api key' });
  };

/** Signed, expiring links so publishers (Ayrshare, n8n...) can fetch an uploaded video without logging in. */
export function signMedia(postId: number, ttlHours = 72) {
  const exp = Date.now() + ttlHours * 36e5;
  return `${config.publicUrl}/media/${postId}?exp=${exp}&sig=${sign(`media:${postId}:${exp}`)}`;
}
export function checkMediaSig(postId: number, exp: number, sig: string) {
  const expected = sign(`media:${postId}:${exp}`);
  return exp > Date.now() && sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

// Very small brute-force guard for the login form.
const attempts = new Map<string, { n: number; until: number }>();
export function loginAllowed(ip: string) {
  const a = attempts.get(ip);
  return !a || a.until < Date.now() || a.n < 8;
}
export function loginFailed(ip: string) {
  const a = attempts.get(ip);
  if (!a || a.until < Date.now()) attempts.set(ip, { n: 1, until: Date.now() + 15 * 6e4 });
  else a.n++;
}
