import { config } from './config.js';

/** Sends a message to our private Discord channel (job done, service down, report ready...). */
export async function notify(text: string) {
  if (!config.notifyWebhook) return;
  try {
    await fetch(config.notifyWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ content: text.slice(0, 1990), allowed_mentions: { parse: [] } }),
    });
  } catch (err) {
    console.error('notify failed', err);
  }
}
