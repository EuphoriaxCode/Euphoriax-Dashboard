import { signMedia } from '../auth.js';
import { config } from '../config.js';
import { db, logActivity, now } from '../db.js';
import { notify } from '../notify.js';

export const PLATFORMS = ['tiktok', 'youtube', 'instagram', 'twitter'] as const;

export interface PostRow {
  id: number; title: string; caption: string | null; captions_json: string | null; hashtags: string | null;
  platforms: string; file: string | null; file_name: string | null; scheduled_at: number; status: string;
  results_json: string | null;
}

interface PlatformResult { status: 'published' | 'failed' | 'manual'; url?: string; error?: string }

export function captionFor(post: PostRow, platform: string) {
  const per = post.captions_json ? JSON.parse(post.captions_json) : {};
  const base = per[platform] || post.caption || post.title;
  return post.hashtags && !per[platform] ? `${base}\n\n${post.hashtags}` : base;
}

// Ayrshare posts one video to TikTok, YouTube, Instagram and X with a single API call, which saves us
// from four separate developer-app approvals. See https://www.ayrshare.com/docs/apis/post/post
async function viaAyrshare(post: PostRow, platforms: string[]): Promise<Record<string, PlatformResult>> {
  const per = post.captions_json ? JSON.parse(post.captions_json) : {};
  const res = await fetch('https://api.ayrshare.com/api/post', {
    method: 'POST',
    headers: { authorization: `Bearer ${config.ayrshareKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      post: captionFor(post, 'default'),
      platforms,
      mediaUrls: [signMedia(post.id)],
      isVideo: true,
      // Platform-specific text overrides the shared caption where we have one.
      ...(Object.keys(per).length ? { postOverrides: Object.fromEntries(platforms.map((p) => [p, { post: captionFor(post, p) }])) } : {}),
      youTubeOptions: { title: (per.youtubeTitle || post.title).slice(0, 100), visibility: 'public', shorts: true },
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  const out: Record<string, PlatformResult> = {};
  for (const p of platforms) out[p] = { status: 'failed', error: body.message || `HTTP ${res.status}` };
  for (const r of body.postIds ?? []) {
    if (r.platform) out[r.platform] = { status: r.status === 'error' ? 'failed' : 'published', url: r.postUrl };
  }
  for (const e of body.errors ?? []) {
    if (e.platform) out[e.platform] = { status: 'failed', error: e.message || JSON.stringify(e).slice(0, 200) };
  }
  return out;
}

// Generic hand-off to n8n / Make / Zapier or our own script: it gets everything needed to post.
async function viaWebhook(post: PostRow, platforms: string[]): Promise<Record<string, PlatformResult>> {
  const res = await fetch(config.publishWebhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      id: post.id, title: post.title, mediaUrl: signMedia(post.id), fileName: post.file_name,
      platforms: Object.fromEntries(platforms.map((p) => [p, { caption: captionFor(post, p) }])),
    }),
  });
  const body: any = await res.json().catch(() => ({}));
  return Object.fromEntries(platforms.map((p) => [p, res.ok
    ? { status: 'published' as const, url: body?.[p]?.url }
    : { status: 'failed' as const, error: `webhook HTTP ${res.status}` }]));
}

export async function publish(post: PostRow) {
  const platforms = post.platforms.split(',').filter(Boolean);
  db.prepare(`UPDATE posts SET status = 'publishing' WHERE id = ?`).run(post.id);
  let results: Record<string, PlatformResult>;
  try {
    if (config.publisher === 'ayrshare' && config.ayrshareKey) results = await viaAyrshare(post, platforms);
    else if (config.publisher === 'webhook' && config.publishWebhook) results = await viaWebhook(post, platforms);
    else results = Object.fromEntries(platforms.map((p) => [p, { status: 'manual' as const }]));
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    results = Object.fromEntries(platforms.map((p) => [p, { status: 'failed' as const, error }]));
  }
  const values = Object.values(results);
  const status = values.every((r) => r.status === 'manual') ? 'manual'
    : values.every((r) => r.status === 'published') ? 'published'
      : values.some((r) => r.status === 'published') ? 'partial' : 'failed';
  db.prepare(`UPDATE posts SET status = ?, results_json = ? WHERE id = ?`).run(status, JSON.stringify(results), post.id);

  if (status === 'manual') {
    logActivity(`"${post.title}" is due - post it manually (no publisher configured)`);
    await notify(`📤 **Time to post** "${post.title}" on ${platforms.join(', ')} (manual mode)`);
  } else {
    const failed = Object.entries(results).filter(([, r]) => r.status === 'failed');
    logActivity(`Published "${post.title}": ${status}${failed.length ? ` (failed: ${failed.map(([p]) => p).join(', ')})` : ''}`);
    await notify(`${status === 'published' ? '✅' : '⚠️'} **${post.title}** -> ${status}` +
      (failed.length ? `\n${failed.map(([p, r]) => `${p}: ${r.error}`).join('\n')}` : ''));
  }
}

export async function publishDue() {
  const due = db.prepare(`SELECT * FROM posts WHERE status = 'scheduled' AND scheduled_at <= ? ORDER BY scheduled_at LIMIT 5`)
    .all(now()) as unknown as PostRow[];
  for (const p of due) await publish(p);
}
