// Discord User Announcements
// Purpose: Owns the public announcements channel policy.
// Scope: Keeps user-facing rover availability messages separate from admin alerts.
const { EmbedBuilder } = require('discord.js');

const PUBLIC_MODES = new Set(['open', 'turns']);
const WATCHED_EVENT_TYPES = new Set([
  'mode.changed',
  'globalObjective.updated',
  'communityGoal.updated',
  'rovers.allUnlocked',
]);

function createUserAnnouncements(deps) {
  const {
    discordConfig,
    getMode,
    rovers,
    roverManager,
    getGlobalObjective,
    sendToChannel,
    schedulePresenceRotation,
  } = deps;

  const announcementChannelId = discordConfig?.channels?.announcements || null;
  const announcementRoleId = discordConfig?.roles?.announcementPing || null;
  const siteUrl = discordConfig?.siteUrl ? String(discordConfig.siteUrl) : '';

  let previousSnapshot = buildSnapshot();
  let skippedFirstModeChange = false;

  function isPublicMode(mode) {
    return PUBLIC_MODES.has(String(mode || ''));
  }

  function getRecordName(record, fallback = 'A rover') {
    return String(record?.meta?.name || record?.id || fallback);
  }

  function formatPercent(record) {
    const percent = record?.batteryState?.percentDisplay;
    return percent == null ? '' : `${percent}%`;
  }

  function getUnavailableReason(record) {
    if (!record) return 'not connected';
    if (record.locked) return record.lockReason ? `locked (${record.lockReason})` : 'locked';
    if (!roverManager.canReplayRoverId(record.id)) return 'not public';
    return 'not ready';
  }

  function formatRecordLine(record, includeReason = false) {
    const name = getRecordName(record);
    const percent = formatPercent(record);
    const suffix = percent ? `, ${percent}` : '';
    if (!includeReason) return `${name}${suffix}`;
    return `${name} - ${getUnavailableReason(record)}${suffix}`;
  }

  function buildSnapshot() {
    const mode = getMode();
    const publicMode = isPublicMode(mode);
    const objective = typeof getGlobalObjective === 'function' ? getGlobalObjective() : null;
    const objectiveText = objective?.text ? String(objective.text).trim() : '';
    const publicRecords = Array.from(rovers.values()).filter((record) => roverManager.canReplayRoverId(record?.id));
    const readyRecords = publicMode ? publicRecords.filter((record) => !record.locked) : [];
    const unavailableRecords = publicMode ? publicRecords.filter((record) => record.locked) : publicRecords;

    return {
      mode,
      publicMode,
      objectiveText,
      totalCount: publicRecords.length,
      readyCount: readyRecords.length,
      readyIds: new Set(readyRecords.map((record) => String(record.id))),
      readyRecords,
      unavailableRecords,
    };
  }

  function buildAvailabilityEmbed({ title, description, snapshot, color }) {
    const embed = new EmbedBuilder().setTitle(title).setColor(color).setTimestamp(new Date());
    if (description) embed.setDescription(description);

    embed.addFields({
      name: 'Mode',
      value: String(snapshot.mode || 'unknown'),
      inline: true,
    });

    embed.addFields({
      name: 'Ready Count',
      value: `${snapshot.readyCount}/${snapshot.totalCount}`,
      inline: true,
    });

    if (snapshot.readyRecords.length) {
      embed.addFields({
        name: 'Ready',
        value: snapshot.readyRecords.map((record) => formatRecordLine(record)).join(', ').slice(0, 1024),
        inline: true,
      });
    } else {
      embed.addFields({
        name: 'Ready',
        value: 'none',
        inline: true,
      });
    }

    if (snapshot.unavailableRecords.length) {
      embed.addFields({
        name: 'Not Ready',
        value: snapshot.unavailableRecords.map((record) => formatRecordLine(record, true)).join(', ').slice(0, 1024),
        inline: true,
      });
    }

    if (snapshot.objectiveText) {
      embed.addFields({
        name: 'Objective',
        value: snapshot.objectiveText.slice(0, 1024),
        inline: true,
      });
    }

    if (siteUrl) {
      embed.addFields({
        name: 'Join',
        value: siteUrl,
        inline: false,
      });
    }

    return embed;
  }

  async function sendAnnouncement({ content, embeds, ping = false }) {
    if (!announcementChannelId) return;
    const shouldPing = Boolean(ping && announcementRoleId);
    const body = shouldPing ? `<@&${announcementRoleId}> ${content || ''}`.trim() : content;
    await sendToChannel(
      announcementChannelId,
      body,
      { embeds: Array.isArray(embeds) ? embeds : [] },
      shouldPing ? { parse: [], roles: [announcementRoleId] } : { parse: [] },
      !shouldPing,
    );
  }

  function didObjectiveChange(prev, next) {
    return String(prev?.objectiveText || '') !== String(next?.objectiveText || '');
  }

  // Mode-open pings: ping only when the server is switched to open/turns, never for the first mode event after startup.
  async function maybeAnnouncePublicMode(event, next) {
    if (event?.type !== 'mode.changed') return false;
    if (!skippedFirstModeChange) {
      skippedFirstModeChange = true;
      return false;
    }
    if (!next.publicMode) return false;

    await sendAnnouncement({
      content: `Server mode changed to ${next.mode}.`,
      ping: true,
      embeds: [buildAvailabilityEmbed({
        title: `Server Mode Changed To ${next.mode}`,
        description: `The server was switched to **${next.mode}** mode.`,
        snapshot: next,
        color: 0x4caf50,
      })],
    });
    return true;
  }

  // All-unlocked pings: ping only when every rover has been unlocked.
  async function maybeAnnounceAllUnlocked(event, next) {
    if (event?.type !== 'rovers.allUnlocked') return false;
    await sendAnnouncement({
      content: 'All rovers are unlocked.',
      ping: true,
      embeds: [buildAvailabilityEmbed({
        title: 'All Rovers Unlocked',
        description: 'Every rover is now unlocked.',
        snapshot: next,
        color: 0x4caf50,
      })],
    });
    return true;
  }

  // Objective pings: ping whenever the objective text changes, and say the objective in the message text.
  async function maybeAnnounceObjective(event, prev, next) {
    if (event?.type !== 'globalObjective.updated' && event?.type !== 'communityGoal.updated') return false;
    if (!didObjectiveChange(prev, next)) return false;

    const objectiveText = next.objectiveText || 'cleared';
    await sendAnnouncement({
      content: `Objective changed to: ${objectiveText}`,
      ping: true,
      embeds: [buildAvailabilityEmbed({
        title: 'Objective Changed',
        description: next.objectiveText ? `New objective: ${next.objectiveText}` : 'The objective was cleared.',
        snapshot: next,
        color: 0x8bc34a,
      })],
    });
    return true;
  }

  async function handleBusEvent(event) {
    if (!WATCHED_EVENT_TYPES.has(event?.type)) return;

    const prev = previousSnapshot;
    const next = buildSnapshot();
    previousSnapshot = next;
    if (schedulePresenceRotation) schedulePresenceRotation();

    try {
      if (await maybeAnnounceObjective(event, prev, next)) return;
      if (await maybeAnnouncePublicMode(event, next)) return;
      await maybeAnnounceAllUnlocked(event, next);
    } catch (err) {
      // The caller logs send failures; this catch keeps one announcement bug from breaking event dispatch.
      const logger = deps.logger;
      if (logger?.warn) logger.warn('User announcement failed', { type: event?.type, error: err.message });
    }
  }

  return {
    handleBusEvent,
  };
}

module.exports = {
  createUserAnnouncements,
};
