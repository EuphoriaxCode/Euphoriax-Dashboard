import { config } from '../config.js';
import { kvGet, kvSet, recordMetric, upsertContent } from '../db.js';
import { getJson, toMs, type Connector } from './types.js';

const API = 'https://open.tiktokapis.com/v2';

// TikTok access tokens live 24h; refresh tokens rotate, so we keep the newest one in the db.
async function accessToken() {
  const cached = kvGet<{ access: string; exp: number; refresh: string }>('tiktok_token');
  if (cached && cached.exp > Date.now() + 60_000) return cached.access;
  const refresh = cached?.refresh || config.tiktok.refreshToken;
  const body = new URLSearchParams({
    client_key: config.tiktok.clientKey, client_secret: config.tiktok.clientSecret,
    grant_type: 'refresh_token', refresh_token: refresh,
  });
  const t = await getJson(`${API}/oauth/token/`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
  });
  if (!t.access_token) throw new Error(`token refresh failed: ${JSON.stringify(t).slice(0, 200)}`);
  kvSet('tiktok_token', { access: t.access_token, exp: Date.now() + t.expires_in * 1000, refresh: t.refresh_token || refresh });
  return t.access_token as string;
}

export const tiktok: Connector = {
  name: 'TikTok',
  platform: 'tiktok',
  setup: 'TikTok client key, secret and refresh token on the Setup page',
  configured: () => !!(config.tiktok.clientKey && config.tiktok.clientSecret && config.tiktok.refreshToken),
  async collect() {
    const auth = { authorization: `Bearer ${await accessToken()}` };
    const me = await getJson(`${API}/user/info/?fields=follower_count,likes_count,video_count`, { headers: auth });
    recordMetric('tiktok', 'followers', me.data?.user?.follower_count);
    recordMetric('tiktok', 'total_likes', me.data?.user?.likes_count);

    const list = await getJson(
      `${API}/video/list/?fields=id,title,video_description,share_url,cover_image_url,create_time,view_count,like_count,comment_count,share_count`,
      { method: 'POST', headers: { ...auth, 'content-type': 'application/json' }, body: JSON.stringify({ max_count: 20 }) },
    );
    const videos = list.data?.videos ?? [];
    for (const v of videos) {
      upsertContent({
        platform: 'tiktok', nativeId: v.id, title: v.title || v.video_description, url: v.share_url,
        thumbnail: v.cover_image_url, publishedAt: toMs(v.create_time),
        views: v.view_count, likes: v.like_count, comments: v.comment_count, shares: v.share_count,
      });
    }
    return `${videos.length} videos, ${me.data?.user?.follower_count ?? '?'} followers`;
  },
};
