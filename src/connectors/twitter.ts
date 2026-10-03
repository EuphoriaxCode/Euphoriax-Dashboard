import { config } from '../config.js';
import { recordMetric, upsertContent } from '../db.js';
import { getJson, toMs, type Connector } from './types.js';

const API = 'https://api.x.com/2';

export const twitter: Connector = {
  name: 'X / Twitter',
  platform: 'twitter',
  setup: 'TWITTER_BEARER_TOKEN + TWITTER_USER_ID (reading tweets needs a paid X API tier)',
  configured: () => !!(config.twitter.bearer && config.twitter.userId),
  async collect() {
    const headers = { authorization: `Bearer ${config.twitter.bearer}` };
    const me = await getJson(`${API}/users/${config.twitter.userId}?user.fields=public_metrics`, { headers });
    recordMetric('twitter', 'followers', me.data?.public_metrics?.followers_count);
    const tw = await getJson(
      `${API}/users/${config.twitter.userId}/tweets?max_results=20&exclude=retweets,replies&tweet.fields=created_at,public_metrics`,
      { headers },
    );
    for (const t of tw.data ?? []) {
      const m = t.public_metrics ?? {};
      upsertContent({
        platform: 'twitter', nativeId: t.id, title: t.text.slice(0, 120),
        url: `https://x.com/i/status/${t.id}`, publishedAt: toMs(t.created_at),
        views: m.impression_count, likes: m.like_count, comments: m.reply_count, shares: m.retweet_count,
      });
    }
    return `${tw.data?.length ?? 0} posts, ${me.data?.public_metrics?.followers_count ?? '?'} followers`;
  },
};
