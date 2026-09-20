// Owns the single-message live report and the dedicated channel's cleanup.
const { PermissionFlagsBits } = require('discord.js');
const { buildRoverStatusSnapshot } = require('./batteryEmbeds');

function createLiveStatus({ client, logger, discordConfig, roverManager, getActiveDrivers,
  getNickname, io, fetchChannel, sanitizeMentions,
  turnEvents, nicknameEvents }) {
  const COOLDOWN_MS = 2000;
  let timer = null;
  let sweepTimer = null;
  let pending = false;
  let cleanupNeeded = false;
  let nextUpdateAt = 0;
  let listening = false;
  const unsubscribe = [];
  let stopped = false;
  let running = false;
  let channelId = null;
  let messageId = null;
  let lastContent = null;

  const clean = (value, limit = 120) => sanitizeMentions(String(value ?? ''))
    .replace(/[\r\n]+/g, ' ').slice(0, limit);

  function buildReport() {
    const drivers = getActiveDrivers();
    const roster = roverManager.getRoster();
    const lines = [];
    for (const rover of roster) {
      const snapshot = buildRoverStatusSnapshot(roverManager.rovers.get(rover.id));
      const driverId = drivers[rover.id];
      const driver = driverId ? clean(getNickname(io.sockets.sockets.get(driverId)) || 'Someone', 32) : null;
      const status = snapshot?.docked ? 'docked' : rover.needsHelp ? 'needs help'
        : driver ? `${driver} driving` : rover.locked ? 'locked' : 'available';
      lines.push(`${clean(rover.name, 60)}: ${status}`);
    }
    let content = lines.join('\n') || 'No rovers online.';
    if (content.length > 2000) content = `${content.slice(0, 1950)}\n… More rovers online.`;
    return { content, allowedMentions: { parse: [] } };
  }

  function schedule() {
    if (stopped || running || timer || !pending || !client.isReady()
      || !discordConfig.channels?.liveStatus?.trim()) return;
    // Use a fixed deadline rather than resetting a debounce on every sensor
    // frame: a continuously changing rover must not postpone updates forever.
    timer = setTimeout(() => {
      timer = null;
      flush();
    }, Math.max(0, nextUpdateAt - Date.now()));
    timer.unref?.();
  }

  function update(forceCleanup = false) {
    if (stopped) return;
    pending = true;
    cleanupNeeded ||= forceCleanup;
    schedule();
  }

  async function flush() {
    if (stopped || running || !client.isReady()) return;
    pending = false;
    const target = discordConfig.channels?.liveStatus?.trim();
    if (target !== channelId) {
      channelId = target;
      messageId = null;
      lastContent = null;
    }
    if (!target) return;
    running = true;
    const cleanup = cleanupNeeded;
    cleanupNeeded = false;
    let usedDiscord = false;
    const active = () => !stopped && client.isReady()
      && discordConfig.channels?.liveStatus?.trim() === target;
    try {
      const report = buildReport();
      const replace = report.content !== lastContent;
      // Sensor events can arrive many times per second. Compare the rendered
      // report locally before consuming any Discord API capacity.
      if (!replace && !cleanup) return;
      usedDiscord = true;
      const channel = await fetchChannel(target);
      if (!active()) return;
      if (!channel?.isTextBased() || !channel.guild || !channel.messages || !channel.send) {
        throw new Error('Live status requires a guild text channel');
      }
      const permissions = channel.permissionsFor(client.user);
      if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.SendMessages, PermissionFlagsBits.ManageMessages])) {
        throw new Error('Live status requires View Channel, Read Message History, Send Messages, and Manage Messages');
      }
      let found = false;
      let before;
      // Paginate the entire history, including pinned and old messages. Individual
      // deletion also handles messages too old for Discord's bulk-delete endpoint.
      while (active()) {
        const messages = await channel.messages.fetch({ limit: 100, before, cache: false });
        if (!active()) return;
        for (const message of messages.values()) {
          if (!active()) return;
          if (!replace && message.id === messageId) {
            found = true;
            continue;
          }
          try {
            await message.delete();
          } catch (err) {
            if (err.code !== 10008) throw err; // Already-deleted messages need no cleanup.
          }
        }
        if (messages.size < 100) break;
        before = messages.last().id;
      }
      if (!active()) return;
      if (replace || !found) {
        const message = await channel.send(report);
        if (!active()) return;
        messageId = message.id;
        lastContent = report.content;
      }
    } catch (err) {
      cleanupNeeded = true;
      logger.warn('Discord live status update failed', { channelId: target, error: err.message });
    } finally {
      running = false;
      // Cool down after completion, so slow deletions and rate-limited requests
      // cannot overlap with another batch. Events received meanwhile stay pending.
      if (usedDiscord) nextUpdateAt = Date.now() + COOLDOWN_MS;
      schedule();
    }
  }

  const onChange = () => update();
  function onDelete(message) {
    if (message.channelId === discordConfig.channels?.liveStatus?.trim()
      && message.id === messageId) update(true);
  }
  function onBulkDelete(messages) {
    for (const message of messages.values()) onDelete(message);
  }

  return {
    update,
    start() {
      if (stopped) return;
      if (!listening) {
        listening = true;
        for (const event of ['rover', 'sensor', 'lock', 'private', 'help']) {
          roverManager.managerEvents.on(event, onChange);
          unsubscribe.push(() => roverManager.managerEvents.off(event, onChange));
        }
        turnEvents.on('activeDriver', onChange);
        nicknameEvents.on('change', onChange);
        client.on('messageDelete', onDelete);
        client.on('messageDeleteBulk', onBulkDelete);
        unsubscribe.push(
          () => turnEvents.off('activeDriver', onChange),
          () => nicknameEvents.off('change', onChange),
          () => client.off('messageDelete', onDelete),
          () => client.off('messageDeleteBulk', onBulkDelete),
        );
      }
      clearInterval(sweepTimer);
      sweepTimer = null;
      if (discordConfig.channels?.liveStatus?.trim()) {
        // Recover from missed gateway events and failed operations without polling
        // for normal rover changes, which are handled by the subscriptions above.
        sweepTimer = setInterval(() => update(true), 30000);
        sweepTimer.unref?.();
      }
      update(true);
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      clearInterval(sweepTimer);
      unsubscribe.forEach((remove) => remove());
    },
  };
}

module.exports = { createLiveStatus };
