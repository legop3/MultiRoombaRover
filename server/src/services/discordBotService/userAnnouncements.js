// Discord User Announcements
// Purpose: Owns the public announcements channel policy.
// Scope: Keeps user-facing rover availability messages separate from admin alerts.
const { EmbedBuilder } = require('discord.js');

const PUBLIC_MODES = new Set(['open', 'turns']);
const WATCHED_EVENT_TYPES = new Set([
  'mode.changed',
  'globalObjective.updated',
  'communityGoal.updated',
  'rover.online',
  'rover.offline',
  'rover.locked',
  'rover.unlocked',
  'rovers.allUnlocked',
  'rover.privateOpened',
  'rover.privateClosed',
  'battery.locked',
  'battery.unlocked',
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

  function isPublicMode(mode) {
    return PUBLIC_MODES.has(String(mode || ''));
  }

  function getRecordName(record, fallback = 'A rover') {
    return String(record?.meta?.name || record?.id || fallback);
  }

  function getEventRoverName(payload = {}) {
    const roverId = payload?.roverId ? String(payload.roverId) : '';
    if (!roverId) return 'A rover';
    return getRecordName(rovers.get(roverId), roverId);
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

    if (snapshot.readyRecords.length) {
      embed.addFields({
        name: 'Ready',
        value: snapshot.readyRecords.map((record) => formatRecordLine(record)).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    if (snapshot.unavailableRecords.length) {
      embed.addFields({
        name: 'Not Ready',
        value: snapshot.unavailableRecords.map((record) => formatRecordLine(record, true)).join('\n').slice(0, 1024),
        inline: false,
      });
    }

    embed.addFields({
      name: 'Mode',
      value: String(snapshot.mode || 'unknown'),
      inline: true,
    });

    if (snapshot.objectiveText) {
      embed.addFields({
        name: 'Objective',
        value: snapshot.objectiveText.slice(0, 1024),
        inline: false,
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

  function hasAnyReadyRover(snapshot) {
    return snapshot.publicMode && snapshot.readyCount > 0;
  }

  function wasAnyReadyRover(snapshot) {
    return snapshot?.publicMode && snapshot.readyCount > 0;
  }

  function didObjectiveChange(prev, next) {
    return String(prev?.objectiveText || '') !== String(next?.objectiveText || '');
  }

  function isPositiveReadyTransition(prev, next) {
    return next.publicMode && prev?.readyCount === 0 && next.readyCount > 0;
  }

  function isNegativeReadyTransition(prev, next) {
    return next.publicMode && prev?.readyCount > 0 && next.readyCount === 0;
  }

  function didPublicAccessClose(prev, next) {
    return prev?.publicMode && !next.publicMode;
  }

  function findNewReadyRecord(prev, next) {
    return next.readyRecords.find((record) => !prev?.readyIds?.has(String(record.id))) || next.readyRecords[0] || null;
  }

  // Positive availability messages: these are the only rover availability posts that ping subscribers.
  async function maybeAnnounceRoversAvailable(event, prev, next) {
    if (!isPositiveReadyTransition(prev, next)) return false;
    const eventType = event?.type || '';
    const record = eventType === 'mode.changed' ? null : findNewReadyRecord(prev, next);
    const title = eventType === 'mode.changed'
      ? 'Rovers Are Open'
      : `${getRecordName(record)} Is Ready`;
    const content = eventType === 'mode.changed'
      ? `Rovers are open: ${next.readyCount} ready`
      : `${getRecordName(record)} is ready`;
    const description = `${next.readyCount}/${next.totalCount} public rovers ready.`;

    await sendAnnouncement({
      content,
      ping: true,
      embeds: [buildAvailabilityEmbed({ title, description, snapshot: next, color: 0x4caf50 })],
    });
    return true;
  }

  // Public access closed messages: useful context, but never ping for negative server state.
  async function maybeAnnounceAccessPaused(prev, next) {
    if (!didPublicAccessClose(prev, next)) return false;
    await sendAnnouncement({
      content: 'Rovers are paused',
      embeds: [buildAvailabilityEmbed({
        title: 'Rovers Are Paused',
        description: 'Public driving is currently closed.',
        snapshot: next,
        color: 0xf0b651,
      })],
    });
    return true;
  }

  // All-ready-lost messages: useful context, but never ping for negative rover state.
  async function maybeAnnounceNoReadyRovers(event, prev, next) {
    if (!isNegativeReadyTransition(prev, next)) return false;
    const roverName = event?.payload?.roverId ? getEventRoverName(event.payload) : null;
    const content = roverName ? `${roverName} is not ready` : 'No rovers are ready right now';
    const title = roverName ? `${roverName} Is Not Ready` : 'No Rovers Are Ready';

    await sendAnnouncement({
      content,
      embeds: [buildAvailabilityEmbed({
        title,
        description: 'Public access is open, but there are no ready rovers.',
        snapshot: next,
        color: 0xf0b651,
      })],
    });
    return true;
  }

  // Objective messages: setting a useful objective pings only when there are usable public rovers.
  async function maybeAnnounceObjective(event, prev, next) {
    if (event?.type !== 'globalObjective.updated' && event?.type !== 'communityGoal.updated') return false;
    if (!didObjectiveChange(prev, next)) return false;

    if (next.objectiveText && hasAnyReadyRover(next)) {
      await sendAnnouncement({
        content: 'New objective',
        ping: true,
        embeds: [buildAvailabilityEmbed({
          title: 'New Objective',
          description: next.objectiveText,
          snapshot: next,
          color: 0x8bc34a,
        })],
      });
      return true;
    }

    if (!next.objectiveText && wasAnyReadyRover(prev)) {
      await sendAnnouncement({
        content: 'Objective cleared',
        embeds: [buildAvailabilityEmbed({
          title: 'Objective Cleared',
          description: 'There is no current objective.',
          snapshot: next,
          color: 0x2196f3,
        })],
      });
      return true;
    }

    return false;
  }

  async function handleBusEvent(event) {
    if (!WATCHED_EVENT_TYPES.has(event?.type)) return;

    const prev = previousSnapshot;
    const next = buildSnapshot();
    previousSnapshot = next;
    if (schedulePresenceRotation) schedulePresenceRotation();

    try {
      if (await maybeAnnounceObjective(event, prev, next)) return;
      if (await maybeAnnounceRoversAvailable(event, prev, next)) return;
      if (await maybeAnnounceAccessPaused(prev, next)) return;
      await maybeAnnounceNoReadyRovers(event, prev, next);
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
