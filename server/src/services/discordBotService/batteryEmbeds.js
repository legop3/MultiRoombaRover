// Discord Battery Embed Helpers
// Purpose: Centralizes rover battery/status snapshot formatting and embed rendering for Discord surfaces.
// Scope: Shared presentation logic for status commands and admin alert battery event posts.
const { EmbedBuilder } = require('discord.js');

function formatVoltage(voltageMv) {
  if (voltageMv == null) return 'n/a';
  return `${(voltageMv / 1000).toFixed(2)}V`;
}

function formatCurrent(currentMa) {
  if (currentMa == null) return 'n/a';
  return `${currentMa}mA`;
}

function formatChargeState(batteryState) {
  if (!batteryState) return 'n/a';
  const charge = batteryState.charge;
  const capacity = batteryState.capacity;
  const percent = batteryState.percentDisplay;
  const chargeText = charge != null && capacity != null ? `${charge}/${capacity}mAh` : 'n/a';
  const percentText = percent != null ? `${percent}%` : 'n/a';
  return `${chargeText} (${percentText})`;
}

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

function isCharging(sensors) {
  const label = sensors?.chargingState?.label?.toLowerCase();
  const chargingByLabel = label === 'waiting' || label === 'full charging' || label === 'trickle charging';
  const code = sensors?.chargingState?.code;
  const chargingByCode = code === 2 || code === 3 || code === 4;
  return chargingByLabel || chargingByCode;
}

function buildRoverStatusSnapshot(record) {
  if (!record) return null;
  const sensors = record.lastSensor?.decoded || record.lastSensor?.sensors || null;
  return {
    id: record.id,
    name: record.meta?.name || record.id,
    locked: record.locked,
    lockReason: record.lockReason,
    docked: Boolean(sensors?.chargingSources?.homeBase),
    charging: isCharging(sensors),
    chargingLabel: sensors?.chargingState?.label || 'unknown',
    voltageMv: sensors?.voltageMv ?? null,
    currentMa: sensors?.currentMa ?? null,
    batteryState: record.batteryState,
    oiMode: sensors?.oiMode?.label || 'unknown',
  };
}

function buildBatteryStatusEmbed({ color = 0x2196f3, records = [], includeOi = true }) {
  const embed = new EmbedBuilder().setTitle('Rover Battery Status').setColor(color).setTimestamp(new Date());
  const snapshots = records.map((entry) => buildRoverStatusSnapshot(entry)).filter(Boolean);
  if (!snapshots.length) {
    embed.setDescription('No rovers online.');
    return embed;
  }

  snapshots.forEach((snapshot) => {
    const lockLabel = snapshot.locked ? `locked${snapshot.lockReason ? ` (${snapshot.lockReason})` : ''}` : 'unlocked';
    const dockLabel = snapshot.docked ? 'docked' : 'undocked';
    const chargingLabel = snapshot.charging ? `charging (${snapshot.chargingLabel})` : 'not charging';
    const header = [
      formatBatteryEmoji(snapshot.batteryState),
      formatDockEmoji(snapshot.docked),
      formatChargeEmoji(snapshot.charging),
      formatLockEmoji(snapshot.locked),
    ].join(' ');

    const lines = [
      `Dock: ${dockLabel}`,
      `Charging: ${chargingLabel}`,
      `Battery: ${formatChargeState(snapshot.batteryState)}`,
      `Voltage: ${formatVoltage(snapshot.voltageMv)}`,
      `Current: ${formatCurrent(snapshot.currentMa)}`,
    ];
    if (includeOi) {
      lines.push(`OI: ${snapshot.oiMode} ${formatOiEmoji(snapshot.oiMode)}`);
    }
    lines.push(`Lock: ${lockLabel}`);

    embed.addFields({
      name: `${header} ${snapshot.name}`,
      value: lines.join('\n'),
      inline: true,
    });
  });

  return embed;
}

function buildBatteryCaption(type, record) {
  const snapshot = buildRoverStatusSnapshot(record);
  const base = snapshot?.name || 'unknown';
  const percent = snapshot?.batteryState?.percentDisplay;
  const percentLabel = percent != null ? `${percent}%` : 'n/a';
  const dockLabel = snapshot?.docked ? 'docked' : 'undocked';
  const chargingLabel = snapshot?.charging ? 'charging' : 'not charging';
  const detail = `${dockLabel}, ${chargingLabel}, ${formatVoltage(snapshot?.voltageMv ?? null)}, ${formatCurrent(snapshot?.currentMa ?? null)}, ${formatChargeState(snapshot?.batteryState ?? null)}`;

  switch (type) {
    case 'battery.warn': return `Battery warn: ${base} at ${percentLabel}. ${detail}`;
    case 'battery.urgent': return `Battery urgent: ${base} at ${percentLabel}. ${detail}`;
    case 'battery.docked': return `Docked: ${base}. ${detail}`;
    case 'battery.undocked': return `Undocked: ${base}. ${detail}`;
    case 'battery.charging.start': return `Charging started: ${base}. ${detail}`;
    case 'battery.charging.stop': return `Charging stopped: ${base}. ${detail}`;
    case 'battery.locked': return `Locked for charging: ${base}. ${detail}`;
    case 'battery.unlocked': return `Unlocked after charging: ${base}. ${detail}`;
    default: return `Battery update: ${base}. ${detail}`;
  }
}

module.exports = {
  buildRoverStatusSnapshot,
  buildBatteryStatusEmbed,
  buildBatteryCaption,
};
