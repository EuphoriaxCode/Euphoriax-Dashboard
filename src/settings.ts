import { randomBytes } from 'node:crypto';
import { setOverrides } from './config.js';
import { kvGet, kvSet } from './db.js';

/** Everything that can be filled in on the Setup page. */
export interface SettingDef { key: string; label: string; group: string; secret?: boolean; help?: string; placeholder?: string; options?: string[] }

export const SETTINGS: SettingDef[] = [
  { group: 'General', key: 'PUBLIC_URL', label: 'Dashboard address', placeholder: 'https://euphoriax.net/dashboard', help: 'The address you open this dashboard on. Used in Discord pings and the build PC script.' },
  { group: 'General', key: 'NOTIFY_DISCORD_WEBHOOK', label: 'Discord webhook for pings', secret: true, help: 'Private channel → Edit channel → Integrations → Webhooks → New → Copy URL. Gets: build done, service down, report ready, time to post.' },

  { group: 'Discord bots (Bot Buddy)', key: 'BUDDY_URL', label: 'Bot Buddy address', placeholder: 'http://127.0.0.1:3000', help: 'Where Discord-Bot-Buddy runs (its PORT, default 3000).' },
  { group: 'Discord bots (Bot Buddy)', key: 'BUDDY_API_KEY', label: 'Bot Buddy DASHBOARD_API_KEY', secret: true, help: 'Same value as DASHBOARD_API_KEY in Bot Buddy’s .env.' },
  { group: 'Discord bots (Bot Buddy)', key: 'BUDDY_WEBHOOK_SECRET', label: 'Bot Buddy DASHBOARD_WEBHOOK_SECRET (optional)', secret: true, help: 'For instant updates: in Bot Buddy set DASHBOARD_WEBHOOK_URL to the address shown below and the same secret here.' },
  { group: 'Discord bots (Bot Buddy)', key: 'DISCORD_BOT_TOKEN', label: 'Any bot token in the server (optional)', secret: true, help: 'Only for member counts. You can reuse one of the Bot Buddy tokens.' },
  { group: 'Discord bots (Bot Buddy)', key: 'DISCORD_GUILD_ID', label: 'Discord server ID (optional)', help: 'Right-click the server icon → Copy Server ID (developer mode on).' },

  { group: 'UEFN Trends', key: 'UEFN_TRENDS_URL', label: 'UEFN Trends address', placeholder: 'http://127.0.0.1:3100' },
  { group: 'UEFN Trends', key: 'UEFN_TRENDS_ADMIN_KEY', label: 'UEFN Trends API_ADMIN_KEY (optional)', secret: true, help: 'Lets you run a trend report and add watchlist items from here.' },

  { group: 'AI', key: 'AI_ENGINE', label: 'Daily analysis runs on', options: ['openai', 'machine', 'api'], help: 'openai = on the server with your OpenAI key (default, works when the build PC is off). machine = the build PC with your Claude subscription. api = Claude API key. The build PC always builds with Claude.' },
  { group: 'AI', key: 'OPENAI_API_KEY', label: 'OpenAI API key', secret: true, help: 'platform.openai.com/api-keys. Use a prepaid balance without auto-recharge. Also writes the captions for your videos.' },
  { group: 'AI', key: 'OPENAI_MODEL', label: 'OpenAI model for the analysis', placeholder: 'gpt-5-mini', help: 'gpt-5-mini is cheap (a few cents per report). gpt-5 thinks harder and costs a few times more.' },
  { group: 'AI', key: 'ANTHROPIC_API_KEY', label: 'Claude API key (only for the "api" option)', secret: true },
  { group: 'AI', key: 'DAILY_ANALYSIS_HOUR', label: 'Hour of the daily analysis (0-23)', placeholder: '7' },

  { group: 'Build PC', key: 'MACHINE_WORK_DIR', label: 'UEFN project folder on the build PC', placeholder: 'C:\\UEFN\\Euphoriax', help: 'Claude starts in this folder. Leave empty to use the folder where you put the start script.' },

  { group: 'Socials', key: 'YOUTUBE_API_KEY', label: 'YouTube API key', secret: true, help: 'console.cloud.google.com → enable "YouTube Data API v3" → Credentials → API key.' },
  { group: 'Socials', key: 'YOUTUBE_CHANNEL_ID', label: 'YouTube channel (@handle, link or ID)', placeholder: '@euphoriax_official', help: 'Your @handle, the link to your channel, or the ID that starts with UC (youtube.com/account_advanced).' },
  { group: 'Socials', key: 'TIKTOK_CLIENT_KEY', label: 'TikTok client key' },
  { group: 'Socials', key: 'TIKTOK_CLIENT_SECRET', label: 'TikTok client secret', secret: true },
  { group: 'Socials', key: 'TIKTOK_REFRESH_TOKEN', label: 'TikTok refresh token', secret: true, help: 'From the TikTok for Developers login flow (scopes user.info.stats, video.list).' },
  { group: 'Socials', key: 'INSTAGRAM_TOKEN', label: 'Instagram Graph API token', secret: true },
  { group: 'Socials', key: 'INSTAGRAM_USER_ID', label: 'Instagram business account ID' },
  { group: 'Socials', key: 'TWITTER_BEARER_TOKEN', label: 'X bearer token', secret: true, help: 'Reading posts needs a paid X API plan.' },
  { group: 'Socials', key: 'TWITTER_USER_ID', label: 'X user ID' },

  { group: 'Patreon', key: 'PATREON_ACCESS_TOKEN', label: 'Creator access token', secret: true, help: 'patreon.com/portal/registration/register-clients → your client → Creator’s Access Token.' },
  { group: 'Patreon', key: 'PATREON_WEBHOOK_SECRET', label: 'Webhook secret (for live sales)', secret: true, help: 'patreon.com/portal/registration/register-webhooks → add the address shown below → copy its secret here.' },

  { group: 'Posting', key: 'PUBLISHER', label: 'How videos get posted', options: ['manual', 'ayrshare', 'webhook'], help: 'manual = Discord ping when it’s time to post. ayrshare = automatic to all 4 platforms. webhook = send to n8n/Make.' },
  { group: 'Posting', key: 'AYRSHARE_API_KEY', label: 'Ayrshare API key', secret: true },
  { group: 'Posting', key: 'PUBLISH_WEBHOOK_URL', label: 'Webhook URL (n8n / Make)', secret: true },
];

const KEYS = new Set(SETTINGS.map((s) => s.key));

export function loadSettings() {
  // Generated once, so there are no secrets to invent by hand.
  const stored = kvGet<Record<string, string>>('settings') ?? {};
  const generated = kvGet<Record<string, string>>('generated') ?? {};
  for (const k of ['SESSION_SECRET', 'INGEST_KEY', 'MACHINE_KEY']) {
    if (!process.env[k] && !generated[k]) generated[k] = randomBytes(24).toString('base64url');
  }
  kvSet('generated', generated);
  const usable = Object.fromEntries(Object.entries(generated).filter(([k]) => !process.env[k]));
  setOverrides({ ...usable, ...stored });
}

export function saveSettings(values: Record<string, string>) {
  const stored = kvGet<Record<string, string>>('settings') ?? {};
  for (const [k, v] of Object.entries(values)) {
    if (!KEYS.has(k)) continue;
    if (v === '') delete stored[k];
    else stored[k] = v;
  }
  kvSet('settings', stored);
  loadSettings();
}

/** For the Setup page: secrets are never sent back, only whether they are set. */
export function publicSettings(read: (k: string) => string) {
  return SETTINGS.map((s) => {
    const value = read(s.key);
    return { ...s, value: s.secret ? '' : value, isSet: !!value };
  });
}

/**
 * If Bot Buddy or UEFN Trends run on the same server (their default ports), fill in their address by itself.
 * Only touches addresses nobody has filled in yet.
 */
export async function autodetectServices(read: (k: string) => string) {
  const found: Record<string, string> = {};
  for (const [key, base] of [['BUDDY_URL', 'http://127.0.0.1:3000'], ['UEFN_TRENDS_URL', 'http://127.0.0.1:3100']]) {
    if (read(key)) continue;
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) found[key] = base;
    } catch { /* not running here */ }
  }
  if (Object.keys(found).length) saveSettings(found);
  return found;
}
