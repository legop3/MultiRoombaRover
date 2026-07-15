// Web Chat Command Transport
// Purpose: Renders status-oriented operator commands as the same plain text web chat expects.
// Scope: Avoids importing Discord.js merely to flatten an embed back into text.
const { resolveRoverSelector } = require('./commands/resolvers');

function formatTimeInZone(date, timeZone) {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
  } catch (_err) {
    return 'n/a';
  }
}

function createWebTransportHandlers({ rovers, roverManager, config, siteUrl = '' }) {
  return {
    async status(message, roverId) {
      const resolved = roverId ? resolveRoverSelector(roverId, rovers) : null;
      if (roverId && resolved?.error) return message.reply(`Rover Status\n\n${resolved.error}`);
      const records = roverId
        ? [resolved.record]
        : Array.from(rovers.values()).filter((entry) => roverManager.canReplayRoverId(entry?.id));
      if (!records.length) return message.reply('Rover Battery Status\n\nNo rovers online.');

      // This mirrors the human-readable content of the established Discord
      // battery embed while remaining a plain transport-neutral chat result.
      const fields = records.map((record) => {
        const sensors = record.lastSensor?.decoded || record.lastSensor?.sensors || {};
        const battery = record.batteryState || {};
        const name = record.meta?.name || record.id;
        const docked = Boolean(sensors?.chargingSources?.homeBase);
        const chargingLabel = String(sensors?.chargingState?.label || 'unknown');
        const charging = ['waiting', 'full charging', 'trickle charging'].includes(chargingLabel.toLowerCase()) || [2, 3, 4].includes(sensors?.chargingState?.code);
        const lockLabel = record.locked ? `locked${record.lockReason ? ` (${record.lockReason})` : ''}` : 'unlocked';
        const charge = battery.charge != null && battery.capacity != null ? `${battery.charge}/${battery.capacity}mAh` : 'n/a';
        const percent = battery.percentDisplay != null ? `${battery.percentDisplay}%` : 'n/a';
        return [
          name,
          `Dock: ${docked ? 'docked' : 'undocked'}`,
          `Charging: ${charging ? `charging (${chargingLabel})` : 'not charging'}`,
          `Battery: ${charge} (${percent})`,
          `Voltage: ${sensors?.voltageMv == null ? 'n/a' : `${(sensors.voltageMv / 1000).toFixed(2)}V`}`,
          `Current: ${sensors?.currentMa == null ? 'n/a' : `${sensors.currentMa}mA`}`,
          `OI: ${String(sensors?.oiMode?.label || 'unknown').toLowerCase()}`,
          `Lock: ${lockLabel}`,
        ].join('\n');
      });
      return message.reply(['Rover Battery Status', ...fields].join('\n\n'));
    },
    async timeStatus(message) {
      const serverTimezone = config.timezone || config.server?.timezone || process.env.TZ || 'America/New_York';
      const zones = [
        ['UTC', 'UTC'], ['US Pacific', 'America/Los_Angeles'], ['US Mountain', 'America/Denver'],
        ['US Central', 'America/Chicago'], ['US Eastern', 'America/New_York'], ['Europe London', 'Europe/London'],
        ['Europe Berlin', 'Europe/Berlin'], ['Asia Kolkata', 'Asia/Kolkata'], ['Asia Shanghai', 'Asia/Shanghai'],
        ['Asia Tokyo', 'Asia/Tokyo'], ['Australia Sydney', 'Australia/Sydney'], ['New Zealand Auckland', 'Pacific/Auckland'],
      ];
      const now = new Date();
      const lines = zones.map(([label, zone]) => `${label} — ${formatTimeInZone(now, zone)}${zone.toLowerCase() === String(serverTimezone).toLowerCase() ? ' **(server local timezone)**' : ''}`);
      if (!zones.some(([, zone]) => zone.toLowerCase() === String(serverTimezone).toLowerCase())) {
        lines.push(`Server Local — ${formatTimeInZone(now, serverTimezone)} **(server local timezone)**`);
      }
      const siteLink = siteUrl ? `\n\n${siteUrl}` : '';
      return message.reply(`Time Status\n${lines.join('\n')}${siteLink}\n\nServer local timezone: ${serverTimezone}`);
    },
  };
}

module.exports = { createWebTransportHandlers };
