import { db, logActivity, now } from './db.js';
import { notify } from './notify.js';
import { config } from './config.js';

// The build queue: we add prompts, the UEFN machine claims them one by one and reports back.

export interface Job {
  id: number; title: string; prompt: string; position: number; status: string; machine: string | null;
  started_at: number | null; finished_at: number | null; summary: string | null; log: string; attempts: number;
  idea_id: number | null; created_at: number; created_by: string | null;
}

const MAX_LOG = 200_000;

export function addJob(title: string, prompt: string, who: string, ideaId: number | null = null, top = false) {
  const edge = db.prepare(`SELECT ${top ? 'MIN' : 'MAX'}(position) p FROM jobs WHERE status = 'queued'`).get() as { p: number | null };
  const position = edge.p === null ? 1000 : top ? edge.p - 1 : edge.p + 1;
  const id = Number(db.prepare(`INSERT INTO jobs (created_at, created_by, title, prompt, position, idea_id) VALUES (?, ?, ?, ?, ?, ?)`)
    .run(now(), who, title, prompt, position, ideaId).lastInsertRowid);
  if (ideaId) db.prepare(`UPDATE ideas SET status = 'queued' WHERE id = ?`).run(ideaId);
  logActivity(`Queued build "${title}"`, who);
  return id;
}

/** Swap with the neighbour above/below in the queue. */
export function moveJob(id: number, dir: 'up' | 'down') {
  const job = db.prepare(`SELECT id, position FROM jobs WHERE id = ? AND status = 'queued'`).get(id) as { id: number; position: number } | undefined;
  if (!job) return;
  const other = db.prepare(dir === 'up'
    ? `SELECT id, position FROM jobs WHERE status = 'queued' AND position < ? ORDER BY position DESC LIMIT 1`
    : `SELECT id, position FROM jobs WHERE status = 'queued' AND position > ? ORDER BY position ASC LIMIT 1`)
    .get(job.position) as { id: number; position: number } | undefined;
  if (!other) return;
  db.prepare('UPDATE jobs SET position = ? WHERE id = ?').run(other.position, job.id);
  db.prepare('UPDATE jobs SET position = ? WHERE id = ?').run(job.position, other.id);
}

export function claimNext(machine: string): Job | null {
  db.exec('BEGIN IMMEDIATE');
  try {
    const job = db.prepare(`SELECT * FROM jobs WHERE status = 'queued' ORDER BY position LIMIT 1`).get() as Job | undefined;
    if (!job) { db.exec('COMMIT'); return null; }
    db.prepare(`UPDATE jobs SET status = 'running', machine = ?, started_at = ?, attempts = attempts + 1 WHERE id = ?`)
      .run(machine, now(), job.id);
    db.exec('COMMIT');
    logActivity(`${machine} started "${job.title}"`, machine);
    void notify(`🛠️ **${machine}** started building "${job.title}"`);
    return { ...job, status: 'running' };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export function appendLog(id: number, chunk: string) {
  const job = db.prepare('SELECT status, length(log) len FROM jobs WHERE id = ?').get(id) as { status: string; len: number } | undefined;
  if (!job) return { cancel: true };
  if (job.len < MAX_LOG) db.prepare('UPDATE jobs SET log = log || ? WHERE id = ?').run(chunk.slice(0, MAX_LOG - job.len), id);
  return { cancel: job.status === 'cancelled' };
}

export function finishJob(id: number, status: 'done' | 'failed' | 'requeue', summary: string) {
  const job = db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Job | undefined;
  if (!job) return;
  if (status === 'requeue') {
    // e.g. Claude usage limit hit - put it back at the front so it runs first when the limit resets.
    db.prepare(`UPDATE jobs SET status = 'queued', machine = NULL, summary = ?, position = (SELECT COALESCE(MIN(position), 1000) - 1 FROM jobs WHERE status = 'queued') WHERE id = ?`)
      .run(summary, id);
    logActivity(`"${job.title}" paused and re-queued: ${summary}`, job.machine ?? 'machine');
    return;
  }
  if (job.status === 'cancelled') status = 'failed';
  db.prepare(`UPDATE jobs SET status = ?, finished_at = ?, summary = ? WHERE id = ? AND status != 'cancelled'`)
    .run(status, now(), summary, id);
  const mins = job.started_at ? Math.round((now() - job.started_at) / 6e4) : 0;
  logActivity(`Build "${job.title}" ${status} after ${mins} min`, job.machine ?? 'machine');
  void notify(`${status === 'done' ? '✅' : '❌'} **Build ${status}**: "${job.title}" (${mins} min)\n${summary.slice(0, 900)}\n${config.publicUrl}/#build`);
}

/** If a machine dies mid-job, put its job back after it has been silent for a while. */
export function recoverStaleJobs() {
  const stale = db.prepare(`SELECT j.id, j.title FROM jobs j LEFT JOIN services s ON s.name = 'machine:' || j.machine
    WHERE j.status = 'running' AND (s.status = 'offline' OR s.status IS NULL)`).all() as { id: number; title: string }[];
  for (const j of stale) finishJob(j.id, 'requeue', 'machine went offline mid-build');
}
