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
      { label: 'UTC', zone: 'UTC' },
      { label: 'US Pacific', zone: 'America/Los_Angeles' },
      { label: 'US Mountain', zone: 'America/Denver' },
      { label: 'US Central', zone: 'America/Chicago' },
      { label: 'US Eastern', zone: 'America/New_York' },
      { label: 'Europe London', zone: 'Europe/London' },
      { label: 'Europe Berlin', zone: 'Europe/Berlin' },
      { label: 'Asia Kolkata', zone: 'Asia/Kolkata' },
      { label: 'Asia Shanghai', zone: 'Asia/Shanghai' },
      { label: 'Asia Tokyo', zone: 'Asia/Tokyo' },
      { label: 'Australia Sydney', zone: 'Australia/Sydney' },
      { label: 'New Zealand Auckland', zone: 'Pacific/Auckland' },
    ];
    const entries = zones.map((entry) => {
      const time = formatTimeInZone(now, entry.zone);
      const highlight =
        String(entry.zone).toLowerCase() === String(serverTimezone).toLowerCase()
          ? ' **(server local timezone)**'
          : '';
      return `${entry.label} — ${time}${highlight}`;
    });
    if (!zones.some((entry) => String(entry.zone).toLowerCase() === String(serverTimezone).toLowerCase())) {
      const time = formatTimeInZone(now, serverTimezone);
      entries.push(`Server Local — ${time} **(server local timezone)**`);
    }
    const embed = buildEmbed({ title: 'Time Status', description: entries.join('\n'), color: 0x2196f3 });
    embed.setFooter({ text: `Server local timezone: ${serverTimezone}` });
    await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createTimeStatusCommand };
