import { readFileSync, existsSync } from 'node:fs';

// Tiny .env loader so we don't need a dependency. Real env vars win.
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}

const env = (k: string, d = '') => process.env[k]?.trim() || d;
const num = (k: string, d: number) => Number(env(k)) || d;

export const config = {
  port: num('PORT', 3200),
  host: env('HOST', '0.0.0.0'),
  /** Public URL of the dashboard, e.g. https://euphoriax.net/dashboard (used for signed media links). */
  publicUrl: env('PUBLIC_URL', 'http://localhost:3200').replace(/\/$/, ''),
  /** Mount path when served behind euphoriax.net, e.g. /dashboard. */
  basePath: env('BASE_PATH', '').replace(/\/$/, ''),
  dataDir: env('DATA_DIR', './data'),
  production: env('NODE_ENV') === 'production',

  // Auth
  /** "name:scrypt-hash,name2:scrypt-hash" - create hashes with `npm run hash-password`. */
  users: env('DASHBOARD_USERS'),
  sessionSecret: env('SESSION_SECRET', 'dev-only-change-me'),
  /** Key for bots/services pushing data in (heartbeats, Discord requests, sales). */
  ingestKey: env('INGEST_KEY'),
  /** Key for the UEFN build machine worker. */
  machineKey: env('MACHINE_KEY'),

  // Notifications
  notifyWebhook: env('NOTIFY_DISCORD_WEBHOOK'),

  // AI
  anthropicKey: env('ANTHROPIC_API_KEY'),
  aiModel: env('AI_MODEL', 'claude-opus-5-5'),
  /** Local hour (server time) the daily analysis runs. */
  dailyHour: num('DAILY_ANALYSIS_HOUR', 7),

  // Incoming connectors
  youtube: { apiKey: env('YOUTUBE_API_KEY'), channelId: env('YOUTUBE_CHANNEL_ID') },
  tiktok: {
    clientKey: env('TIKTOK_CLIENT_KEY'),
    clientSecret: env('TIKTOK_CLIENT_SECRET'),
    refreshToken: env('TIKTOK_REFRESH_TOKEN'),
  },
  instagram: { token: env('INSTAGRAM_TOKEN'), userId: env('INSTAGRAM_USER_ID') },
  twitter: { bearer: env('TWITTER_BEARER_TOKEN'), userId: env('TWITTER_USER_ID') },
  patreon: { token: env('PATREON_ACCESS_TOKEN'), webhookSecret: env('PATREON_WEBHOOK_SECRET') },
  discord: { botToken: env('DISCORD_BOT_TOKEN'), guildId: env('DISCORD_GUILD_ID') },
  uefnTrends: { url: env('UEFN_TRENDS_URL').replace(/\/$/, ''), adminKey: env('UEFN_TRENDS_ADMIN_KEY') },

  // Outgoing
  /** ayrshare | webhook | manual */
  publisher: env('PUBLISHER', 'manual'),
  ayrshareKey: env('AYRSHARE_API_KEY'),
  publishWebhook: env('PUBLISH_WEBHOOK_URL'),

  /** Minutes without a heartbeat before a bot counts as offline. */
  heartbeatTimeoutMin: num('HEARTBEAT_TIMEOUT_MIN', 5),
  collectEveryMin: num('COLLECT_EVERY_MIN', 60),
};

export type Config = typeof config;
