// Discord Time Status Command
// Purpose: Handles `ts` command to show timezone snapshots.
// Scope: Builds a concise time embed for common zones and server local zone.
const { EmbedBuilder } = require('discord.js');

function createTimeStatusCommand({ config, discordConfig }) {
  function buildEmbed({ title, description, color, includeSiteUrl = true }) {
    const embed = new EmbedBuilder().setTitle(title || 'Update').setColor(color || 0x2196f3);
    const siteUrl = includeSiteUrl && discordConfig.siteUrl ? String(discordConfig.siteUrl) : '';
    if (description) embed.setDescription(siteUrl ? `${description}\n\n${siteUrl}` : description);
    else if (siteUrl) embed.setDescription(siteUrl);
    embed.setTimestamp(new Date());
    return embed;
  }
  function getServerTimezone() {
    return config.timezone || config.server?.timezone || process.env.TZ || 'America/New_York';
  }
  function formatTimeInZone(date, timeZone) {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    } catch {
      return 'n/a';
    }
  }
  return async function handleTimeStatusCommand(message) {
    const serverTimezone = getServerTimezone();
    const now = new Date();
    const zones = [
      'UTC',
      'America/Los_Angeles',
      'America/Denver',
      'America/Chicago',
      'America/New_York',
      'America/Halifax',
      'Pacific/Honolulu',
      'Europe/London',
      'Europe/Berlin',
      'Asia/Tokyo',
      'Australia/Sydney',
      'Pacific/Auckland',
    ];
    if (!zones.includes(serverTimezone)) {
      zones.push(serverTimezone);
    }
    const lines = zones.map((zone) => `${zone} — ${formatTimeInZone(now, zone)}${zone === serverTimezone ? ' **(server local timezone)**' : ''}`);
    const embed = buildEmbed({ title: 'Time Status', description: lines.join('\n'), color: 0x2196f3 });
    embed.setFooter({ text: `Server local timezone: ${serverTimezone}` });
    await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createTimeStatusCommand };
