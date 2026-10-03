import { config } from '../config.js';
import { recordMetric, upsertContent } from '../db.js';
import { getJson, toMs, type Connector } from './types.js';

const API = 'https://www.googleapis.com/youtube/v3';

export const youtube: Connector = {
  name: 'YouTube',
  platform: 'youtube',
  setup: 'YOUTUBE_API_KEY + YOUTUBE_CHANNEL_ID (Google Cloud console -> YouTube Data API v3)',
  configured: () => !!(config.youtube.apiKey && config.youtube.channelId),
  async collect() {
    const { apiKey, channelId } = config.youtube;
    const ch = await getJson(`${API}/channels?part=statistics,contentDetails&id=${channelId}&key=${apiKey}`);
    const channel = ch.items?.[0];
    if (!channel) throw new Error('channel not found');
    recordMetric('youtube', 'subscribers', Number(channel.statistics.subscriberCount));
    recordMetric('youtube', 'total_views', Number(channel.statistics.viewCount));

    // The uploads playlist costs 1 quota unit per page, unlike search (100).
    const uploads = channel.contentDetails.relatedPlaylists.uploads;
    const pl = await getJson(`${API}/playlistItems?part=contentDetails&maxResults=50&playlistId=${uploads}&key=${apiKey}`);
    const ids = (pl.items ?? []).map((i: any) => i.contentDetails.videoId).join(',');
    if (!ids) return 'no videos';
    const vids = await getJson(`${API}/videos?part=snippet,statistics&id=${ids}&key=${apiKey}`);
    for (const v of vids.items ?? []) {
      upsertContent({
        platform: 'youtube', nativeId: v.id, title: v.snippet.title,
        url: `https://youtu.be/${v.id}`, thumbnail: v.snippet.thumbnails?.medium?.url,
        publishedAt: toMs(v.snippet.publishedAt),
        views: Number(v.statistics.viewCount ?? 0), likes: Number(v.statistics.likeCount ?? 0),
        comments: Number(v.statistics.commentCount ?? 0),
      });
    }
    return `${vids.items?.length ?? 0} videos, ${channel.statistics.subscriberCount} subs`;
  },
};
