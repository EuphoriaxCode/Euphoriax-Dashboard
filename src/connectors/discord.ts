import { config } from '../config.js';
import { recordMetric } from '../db.js';
import { getJson, type Connector } from './types.js';

export const discord: Connector = {
  name: 'Discord server',
  platform: 'discord',
  setup: 'DISCORD_BOT_TOKEN + DISCORD_GUILD_ID (any bot in the server works; messages come in via /api/ingest/signal)',
  configured: () => !!(config.discord.botToken && config.discord.guildId),
  async collect() {
    const g = await getJson(`https://discord.com/api/v10/guilds/${config.discord.guildId}?with_counts=true`, {
      headers: { authorization: `Bot ${config.discord.botToken}` },
    });
    recordMetric('discord', 'members', g.approximate_member_count);
    recordMetric('discord', 'online', g.approximate_presence_count);
    return `${g.approximate_member_count} members, ${g.approximate_presence_count} online`;
  },
};
