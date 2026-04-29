// Discord Bus Event Integrations
// Purpose: Handles event-bus announcements to Discord channels.
// Scope: Processes supported event types and posts formatted messages/embeds.
const { EmbedBuilder, AttachmentBuilder } = require('discord.js');

function createBusEventHandler(deps) {
  const { logger, discordConfig, MODES, roverManager, rovers, schedulePresenceRotation, formatDuration, sendToChannel } = deps;
  const ADMIN_ALERT_EVENT_TYPES = new Set(['rover.online', 'rover.offline', 'rover.dockGuard', 'battery.warn', 'battery.urgent', 'battery.docked', 'battery.undocked', 'battery.charging.start', 'battery.charging.stop', 'battery.locked', 'battery.unlocked']);
  let skippedFirstModeAnnouncement = false;

  function buildEmbed({ title, description, color, includeSiteUrl = true }) {
    const embed = new EmbedBuilder().setTitle(title || 'Update').setColor(color || 0x2196f3);
    const siteUrl = includeSiteUrl && discordConfig.siteUrl ? String(discordConfig.siteUrl) : '';
    if (description) embed.setDescription(siteUrl ? `${description}\n\n${siteUrl}` : description);
    else if (siteUrl) embed.setDescription(siteUrl);
    embed.setTimestamp(new Date());
    return embed;
  }

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
    };
  }

  function buildBatteryStatusEmbed(color, records = null) {
    const embed = buildEmbed({ title: 'Rover Battery Status', color: color || 0x2196f3 });
    const sourceRecords = records || Array.from(rovers.values());
    const snapshots = sourceRecords.map((entry) => buildRoverStatusSnapshot(entry)).filter(Boolean);
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
      embed.addFields({
        name: `${header} ${snapshot.name}`,
        value: [
          `Dock: ${dockLabel}`,
          `Charging: ${chargingLabel}`,
          `Battery: ${formatChargeState(snapshot.batteryState)}`,
          `Voltage: ${formatVoltage(snapshot.voltageMv)}`,
          `Current: ${formatCurrent(snapshot.currentMa)}`,
          `Lock: ${lockLabel}`,
        ].join('\n'),
        inline: true,
      });
    });
    return embed;
  }

  function buildBatteryCaption(type, payload) {
    const roverId = payload?.roverId || 'unknown';
    const record = rovers.get(roverId) || null;
    const snapshot = buildRoverStatusSnapshot(record);
    const base = snapshot?.name || roverId;
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

  async function announce({ channelId, content, pingRoleId, color, title, description, embeds, files }) {
    if (!channelId) return;
    const prefix = pingRoleId ? `<@&${pingRoleId}> ` : '';
    const payloadEmbeds = Array.isArray(embeds) && embeds.length ? embeds : [buildEmbed({ title, description, color })];
    await sendToChannel(channelId, `${prefix}${content || ''}`.trim(), { embeds: payloadEmbeds, files: Array.isArray(files) ? files : undefined }, { parse: [], roles: pingRoleId ? [pingRoleId] : [] }, !pingRoleId);
  }

  return function handleBusEvent(event) {
    const { type, payload } = event || {};
    const channels = discordConfig.channels || {};
    const roles = discordConfig.roles || {};
    const roverId = payload?.roverId || null;
    if (roverId && !roverManager.canReplayRoverId(roverId) && !ADMIN_ALERT_EVENT_TYPES.has(type)) return;

    switch (type) {
      case 'mode.changed':
        if (!skippedFirstModeAnnouncement) { skippedFirstModeAnnouncement = true; schedulePresenceRotation(); break; }
        if (payload?.mode === MODES.OPEN || payload?.mode === MODES.TURNS) {
          announce({ channelId: channels.announcements, content: `Access mode set to ${payload?.mode}.`, color: 0x2196f3, title: 'Access Mode Updated', description: `Access mode set to **${payload?.mode}**` });
        }
        schedulePresenceRotation();
        break;
      case 'communityGoal.updated':
        announce({ channelId: channels.announcements, content: payload?.text ? `Community goal: ${payload.text}` : 'Community goal cleared.', color: 0x8bc34a, title: 'Community Goal', description: payload?.text || 'Community goal cleared.' });
        schedulePresenceRotation();
        break;
      case 'rover.online':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0x4caf50, title: 'Rover Online', description: `${payload?.roverId} is online.` });
        break;
      case 'rover.offline':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xe53935, title: 'Rover Offline', description: `${payload?.roverId} went offline.` });
        break;
      case 'rover.dockGuard':
        announce({ channelId: channels.adminAlerts, color: 0xf0b651, title: 'Dock Guard Triggered', description: `${payload?.roverId} (${payload?.reasonText || 'undocked'}) for ${formatDuration(payload?.idleMs)}.` });
        break;
      case 'battery.warn':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xf0b651, content: buildBatteryCaption(type, payload), embeds: [buildBatteryStatusEmbed(0xf0b651, Array.from(rovers.values()))] });
        break;
      case 'battery.urgent':
        announce({ channelId: channels.adminAlerts, pingRoleId: roles.adminPing || null, color: 0xe53935, content: buildBatteryCaption(type, payload), embeds: [buildBatteryStatusEmbed(0xe53935, Array.from(rovers.values()))] });
        break;
      case 'battery.docked':
      case 'battery.undocked':
      case 'battery.charging.start':
        announce({ channelId: channels.adminAlerts, color: 0x2196f3, content: buildBatteryCaption(type, payload), embeds: [buildBatteryStatusEmbed(0x2196f3, Array.from(rovers.values()))] });
        break;
      case 'battery.charging.stop':
      case 'battery.locked':
        announce({ channelId: channels.adminAlerts, color: 0xf0b651, content: buildBatteryCaption(type, payload), embeds: [buildBatteryStatusEmbed(0xf0b651, Array.from(rovers.values()))] });
        break;
      case 'battery.unlocked':
        announce({ channelId: channels.adminAlerts, color: 0x4caf50, content: buildBatteryCaption(type, payload), embeds: [buildBatteryStatusEmbed(0x4caf50, Array.from(rovers.values()))] });
        break;
      case 'humanAlert.buttonPressed': {
        const imageBase64 = payload?.imageBase64 ? String(payload.imageBase64) : '';
        let attachment = null;
        if (imageBase64) {
          try {
            const imageBuffer = Buffer.from(imageBase64, 'base64');
            if (imageBuffer.length > 0) attachment = new AttachmentBuilder(imageBuffer, { name: 'human-alert-mosaic.jpg' });
          } catch (err) { logger.warn('Failed to decode human alert image for Discord', err.message); }
        }
        announce({ channelId: channels.humanAlerts, pingRoleId: roles.humanAlertPing || null, content: payload?.message || 'Human alert button pressed.', embeds: [buildEmbed({ title: 'Human Alert Button Pressed', description: null, color: 0xe53935 })], files: attachment ? [attachment] : [] });
        break;
      }
      default:
        break;
    }
  };
}

module.exports = { createBusEventHandler };
