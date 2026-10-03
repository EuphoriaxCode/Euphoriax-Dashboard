import { config } from '../config.js';
import { kvGet, kvSet, recordMetric, upsertContent } from '../db.js';
import { getJson, toMs, type Connector } from './types.js';

const API = process.env.YOUTUBE_API_BASE ?? 'https://www.googleapis.com/youtube/v3';

/** Whatever was typed in Setup: the UC… id, a @handle, or any link to the channel. */
export function parseChannelRef(input: string): { id?: string; handle?: string; username?: string } {
  const s = input.trim();
  const id = s.match(/UC[\w-]{22}/)?.[0];
  if (id) return { id };
  const username = s.match(/youtube\.com\/user\/([\w.-]+)/i)?.[1];
  if (username) return { username };
  const fromLink = s.match(/youtube\.com\/(?:@|c\/)?([\w.-]+)(?:\/[^?#]*)?(?:[?#].*)?$/i)?.[1];
  const bare = s.replace(/^@/, '').match(/^[\w.-]+$/)?.[0];
  const handle = fromLink ?? bare;
  return handle ? { handle } : {};
}

/** The API wants the UC… id, so a handle or link is looked up once and remembered. */
async function resolveChannelId(): Promise<string> {
  const { apiKey, channelId: typed } = config.youtube;
  const ref = parseChannelRef(typed);
  if (ref.id) return ref.id;
  const cacheKey = `yt_channel:${typed}`;
  const cached = kvGet<string>(cacheKey);
  if (cached) return cached;
  const lookup = ref.username ? `forUsername=${encodeURIComponent(ref.username)}` : ref.handle ? `forHandle=${encodeURIComponent('@' + ref.handle)}` : '';
  const hint = 'Use your @handle (like @euphoriax_official) or the channel ID that starts with UC (youtube.com/account_advanced).';
  if (!lookup) throw new Error(`Could not read "${typed}" as a YouTube channel. ${hint}`);
  const r = await getJson(`${API}/channels?part=id&${lookup}&key=${apiKey}`);
  const id = r.items?.[0]?.id as string | undefined;
  if (!id) throw new Error(`No YouTube channel found for "${typed}". ${hint}`);
  kvSet(cacheKey, id);
  return id;
}

export const youtube: Connector = {
  name: 'YouTube',
  platform: 'youtube',
  setup: 'YouTube API key + channel (@handle, link or ID) on the Setup page',
  configured: () => !!(config.youtube.apiKey && config.youtube.channelId),
  async collect() {
    const { apiKey } = config.youtube;
    const channelId = await resolveChannelId();
    const ch = await getJson(`${API}/channels?part=statistics,contentDetails&id=${channelId}&key=${apiKey}`);
    const channel = ch.items?.[0];
    if (!channel) throw new Error('YouTube did not return this channel. Check the channel on the Setup page.');
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
