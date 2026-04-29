// Discord Status Command
// Purpose: Handles rover status display command with battery and lock details.
// Scope: Builds and sends rover status embed for one rover or all visible rovers.
const { EmbedBuilder } = require('discord.js');

function createStatusCommand({ rovers, roverManager }) {
  function formatVoltage(voltageMv) { return voltageMv == null ? 'n/a' : `${(voltageMv / 1000).toFixed(2)}V`; }
  function formatCurrent(currentMa) { return currentMa == null ? 'n/a' : `${currentMa}mA`; }
  function formatDockEmoji(docked) { return docked ? '🏠' : '🧭'; }
  function formatChargeEmoji(charging) { return charging ? '⚡' : '🔌'; }
  function formatLockEmoji(locked) { return locked ? '🔒' : '🔓'; }
  function formatBatteryEmoji(batteryState) {
    if (batteryState?.urgentActive) return '🛑';
    if (batteryState?.warnActive) return '⚠️';
    return '🔋';
  }
  function formatOiEmoji(oiMode) {
    if (oiMode === 'full') return '🕹️';
    if (oiMode === 'safe') return '🧰';
    if (oiMode === 'passive') return '🟢';
    if (oiMode === 'off') return '⏹️';
    return '❔';
  }
  function formatChargeState(batteryState) {
    if (!batteryState) return 'n/a';
    const chargeText = batteryState.charge != null && batteryState.capacity != null ? `${batteryState.charge}/${batteryState.capacity}mAh` : 'n/a';
    const percentText = batteryState.percentDisplay != null ? `${batteryState.percentDisplay}%` : 'n/a';
    return `${chargeText} (${percentText})`;
  }
  function findRoverRecord(id) {
    if (!id) return null;
    for (const record of rovers.values()) {
      if (String(record.id) === String(id) || String(record.meta?.name) === String(id)) return record;
    }
    return null;
  }
  function buildSnapshot(record) {
    if (!record) return null;
    const sensors = record.lastSensor?.decoded || record.lastSensor?.sensors || null;
    return {
      name: record.meta?.name || record.id,
      locked: record.locked,
      lockReason: record.lockReason,
      docked: Boolean(sensors?.chargingSources?.homeBase),
      charging: Boolean([2,3,4].includes(sensors?.chargingState?.code)),
      chargingLabel: sensors?.chargingState?.label || 'unknown',
      voltageMv: sensors?.voltageMv ?? null,
      currentMa: sensors?.currentMa ?? null,
      batteryState: record.batteryState,
      oiMode: sensors?.oiMode?.label || 'unknown',
    };
  }
  function buildEmbed(records) {
    const embed = new EmbedBuilder().setTitle('Rover Battery Status').setColor(0x2196f3).setTimestamp(new Date());
    const snapshots = records.map(buildSnapshot).filter(Boolean);
    if (!snapshots.length) {
      embed.setDescription('No rovers online.');
      return embed;
    }
    snapshots.forEach((s) => {
      const lockLabel = s.locked ? `locked${s.lockReason ? ` (${s.lockReason})` : ''}` : 'unlocked';
      const header = [
        formatBatteryEmoji(s.batteryState),
        formatDockEmoji(s.docked),
        formatChargeEmoji(s.charging),
        formatLockEmoji(s.locked),
      ].join(' ');
      embed.addFields({
        name: `${header} ${s.name}`,
        value: [
          `Dock: ${s.docked ? 'docked' : 'undocked'}`,
          `Charging: ${s.charging ? `charging (${s.chargingLabel})` : 'not charging'}`,
          `Battery: ${formatChargeState(s.batteryState)}`,
          `Voltage: ${formatVoltage(s.voltageMv)}`,
          `Current: ${formatCurrent(s.currentMa)}`,
          `OI: ${s.oiMode} ${formatOiEmoji(s.oiMode)}`,
          `Lock: ${lockLabel}`,
        ].join('\n'),
        inline: true,
      });
    });
    return embed;
  }

  return async function handleStatusCommand(message, roverId) {
    const single = roverId ? findRoverRecord(roverId) : null;
    if (roverId && !single) {
      const embed = new EmbedBuilder().setTitle('Rover Status').setDescription('Unknown rover.').setColor(0x2196f3).setTimestamp(new Date());
      await message.reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const records = roverId ? [single] : Array.from(rovers.values()).filter((entry) => roverManager.canReplayRoverId(entry?.id));
    await message.reply({ embeds: [buildEmbed(records)], allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createStatusCommand };
