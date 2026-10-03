import { config } from '../config.js';
import { recordMetric, upsertContent } from '../db.js';
import { getJson, toMs, type Connector } from './types.js';

const API = 'https://graph.facebook.com/v23.0';

export const instagram: Connector = {
  name: 'Instagram',
  platform: 'instagram',
  setup: 'Instagram token + account ID on the Setup page',
  configured: () => !!(config.instagram.token && config.instagram.userId),
  async collect() {
    const { token, userId } = config.instagram;
    const me = await getJson(`${API}/${userId}?fields=followers_count,media_count&access_token=${token}`);
    recordMetric('instagram', 'followers', me.followers_count);
    const media = await getJson(
      `${API}/${userId}/media?fields=id,caption,media_type,permalink,thumbnail_url,timestamp,like_count,comments_count&limit=25&access_token=${token}`,
    );
    for (const m of media.data ?? []) {
      // Views live behind the insights endpoint; not every media type supports it, so it's best-effort.
      let views = 0;
      try {
        const ins = await getJson(`${API}/${m.id}/insights?metric=views&access_token=${token}`);
        views = ins.data?.[0]?.values?.[0]?.value ?? 0;
      } catch { /* ignore */ }
      upsertContent({
        platform: 'instagram', nativeId: m.id, title: (m.caption ?? '').split('\n')[0].slice(0, 120),
        url: m.permalink, thumbnail: m.thumbnail_url, publishedAt: toMs(m.timestamp),
        views, likes: m.like_count, comments: m.comments_count,
      });
    }
    return `${media.data?.length ?? 0} posts, ${me.followers_count} followers`;
  },
};
