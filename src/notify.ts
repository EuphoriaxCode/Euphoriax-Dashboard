import { config } from './config.js';

/** The people who get pinged (@mention) when something serious goes wrong. */
const ALERT_USER_IDS = ['306821069333856256', '753270495150997556'];

/**
 * Sends a message to our private Discord channel (job done, service down, report ready...).
 * `urgent: true` also @mentions the owners: use it only for things that need a human right now.
 */
export async function notify(text: string, opts: { urgent?: boolean } = {}) {
  if (!config.notifyWebhook) return;
  const pings = opts.urgent ? ALERT_USER_IDS.map((id) => `<@${id}>`).join(' ') + '\n' : '';
  try {
    await fetch(config.notifyWebhook, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: (pings + text).slice(0, 1990),
        allowed_mentions: opts.urgent ? { parse: [], users: ALERT_USER_IDS } : { parse: [] },
      }),
    });
  } catch (err) {
    console.error('notify failed', err);
  }
}
