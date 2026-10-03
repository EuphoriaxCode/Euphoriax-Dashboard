import type Anthropic from '@anthropic-ai/sdk';
import { config } from '../config.js';
import { claude, extractJson } from './client.js';

export type Captions = Record<string, string> & { youtubeTitle?: string };

/** Writes platform-specific captions for one video. */
export async function writeCaptions(input: { title: string; notes?: string; platforms: string[] }): Promise<Captions> {
  const msg = await claude().beta.messages.create({
    model: config.aiModel,
    max_tokens: 4000,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system: `You write short-form video captions for Euphoriax, a UEFN/Fortnite creator brand (systems, maps, tutorials;
products on Patreon). Match each platform's style: TikTok/Instagram = hook first line + 3-5 hashtags; X = one punchy
line, max 2 hashtags; YouTube = a <70 char Shorts title in youtubeTitle plus a description with hashtags under "youtube".
Return only a JSON object with one key per requested platform (plus youtubeTitle if youtube is requested).`,
    messages: [{ role: 'user', content: JSON.stringify(input) }],
  });
  if (msg.stop_reason === 'refusal') throw new Error('model declined the request');
  const text = msg.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('');
  return extractJson<Captions>(text);
}
