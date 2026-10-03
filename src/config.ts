import { readFileSync, existsSync } from 'node:fs';

// Tiny .env loader so we don't need a dependency. Real env vars win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

/**
 * Values typed in on the Setup page are stored in the database and win over env vars,
 * so after the first start nobody has to touch the server again.
 */
const overrides = new Map<string, string>();
export function setOverrides(values: Record<string, string>) {
  overrides.clear();
  for (const [k, v] of Object.entries(values)) if (v !== undefined && v !== null && String(v).trim() !== '') overrides.set(k, String(v).trim());
}

export const env = (k: string, d = '') => overrides.get(k) ?? (process.env[k]?.trim() || d);
const num = (k: string, d: number) => Number(env(k)) || d;
const url = (k: string) => env(k).replace(/\/$/, '');

export const config = {
  // ---- server basics (env only) ----
  get port() { return Number(process.env.PORT) || 3200; },
  get host() { return process.env.HOST || '0.0.0.0'; },
  /** Mount path when served behind euphoriax.net, e.g. /dashboard. */
  get basePath() { return (process.env.BASE_PATH ?? '').replace(/\/$/, ''); },
  get dataDir() { return process.env.DATA_DIR || './data'; },
  get production() { return process.env.NODE_ENV === 'production'; },

  // ---- editable on the Setup page ----
  /** Public URL of the dashboard, e.g. https://euphoriax.net/dashboard (used for links and the worker). */
  get publicUrl() { return url('PUBLIC_URL') || `http://localhost:${this.port}${this.basePath}`; },
  get users() { return env('DASHBOARD_USERS'); },
  get sessionSecret() { return env('SESSION_SECRET'); },
  get ingestKey() { return env('INGEST_KEY'); },
  get machineKey() { return env('MACHINE_KEY'); },
  get notifyWebhook() { return env('NOTIFY_DISCORD_WEBHOOK'); },

  get openaiKey() { return env('OPENAI_API_KEY'); },
  get openaiModel() { return env('OPENAI_MODEL', 'gpt-5-mini'); },
  get anthropicKey() { return env('ANTHROPIC_API_KEY'); },
  get aiModel() { return env('AI_MODEL', 'claude-opus-5-5'); },
  /** Where the daily analysis runs: openai (default, on the server), machine (build PC, Claude subscription), api (Claude API key). */
  get aiMode(): 'openai' | 'machine' | 'api' { const m = env('AI_ENGINE'); return m === 'machine' || m === 'api' ? m : 'openai'; },
  /** Short texts (captions) use OpenAI when there is a key, otherwise Claude. */
  get captionsEngine(): 'openai' | 'claude' | null { return this.openaiKey ? 'openai' : this.anthropicKey ? 'claude' : null; },
  get dailyHour() { return num('DAILY_ANALYSIS_HOUR', 7); },

  get youtube() { return { apiKey: env('YOUTUBE_API_KEY'), channelId: env('YOUTUBE_CHANNEL_ID') }; },
  get tiktok() { return { clientKey: env('TIKTOK_CLIENT_KEY'), clientSecret: env('TIKTOK_CLIENT_SECRET'), refreshToken: env('TIKTOK_REFRESH_TOKEN') }; },
  get instagram() { return { token: env('INSTAGRAM_TOKEN'), userId: env('INSTAGRAM_USER_ID') }; },
  get twitter() { return { bearer: env('TWITTER_BEARER_TOKEN'), userId: env('TWITTER_USER_ID') }; },
  get patreon() { return { token: env('PATREON_ACCESS_TOKEN'), webhookSecret: env('PATREON_WEBHOOK_SECRET') }; },
  get discord() { return { botToken: env('DISCORD_BOT_TOKEN'), guildId: env('DISCORD_GUILD_ID') }; },
  /** github.com/EuphoriaxCode/UEFN-Trends */
  get uefnTrends() { return { url: url('UEFN_TRENDS_URL'), adminKey: env('UEFN_TRENDS_ADMIN_KEY') }; },
  /** github.com/EuphoriaxCode/Discord-Bot-Buddy */
  get buddy() { return { url: url('BUDDY_URL'), apiKey: env('BUDDY_API_KEY'), webhookSecret: env('BUDDY_WEBHOOK_SECRET') }; },

  /** ayrshare | webhook | manual */
  get publisher() { return env('PUBLISHER', 'manual'); },
  get ayrshareKey() { return env('AYRSHARE_API_KEY'); },
  get publishWebhook() { return env('PUBLISH_WEBHOOK_URL'); },

  /** Folder on the build PC where Claude starts (pre-filled into the downloaded start script). */
  get machineWorkDir() { return env('MACHINE_WORK_DIR'); },
  get heartbeatTimeoutMin() { return num('HEARTBEAT_TIMEOUT_MIN', 5); },
  get collectEveryMin() { return num('COLLECT_EVERY_MIN', 60); },
};

export type Config = typeof config;
