// Owns the single-message live report and the dedicated channel's cleanup.
const { escapeMarkdown, PermissionFlagsBits } = require('discord.js');
const { buildRoverStatusSnapshot } = require('./batteryEmbeds');

function createLiveStatus({ client, logger, discordConfig, roverManager, getActiveDrivers,
  getNickname, io, getMode, getGlobalObjective, fetchChannel, sanitizeMentions,
  turnEvents, nicknameEvents, subscribe }) {
  const COOLDOWN_MS = 3000;
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
  let lastSignature = null;

  const clean = (value, limit = 120) => sanitizeMentions(String(value ?? ''))
    .replace(/[\r\n]+/g, ' ').slice(0, limit);
  const rich = (value, limit) => escapeMarkdown(clean(value, limit));

  function buildReport() {
    const drivers = getActiveDrivers();
    const roster = roverManager.getRoster();
    const lines = [];
    const fields = [];
    let budget = 4800;
    for (const rover of roster) {
      const snapshot = buildRoverStatusSnapshot(roverManager.rovers.get(rover.id));
      const driverId = drivers[rover.id];
      const driver = driverId ? clean(getNickname(io.sockets.sockets.get(driverId)) || 'Someone', 32) : null;
      const status = rover.needsHelp ? 'needs help' : driver ? `${driver} driving`
        : snapshot?.docked ? 'docked' : rover.locked ? 'locked' : 'available';
      lines.push(`${clean(rover.name, 60)}: ${status}`);
      const battery = snapshot?.batteryState;
      const value = [
        `**${rich(status)}**`,
        `Driver: ${rich(driver || 'none')}`,
        `Battery: ${battery?.percentDisplay == null ? 'unknown' : `${battery.percentDisplay}%`}`,
        `Charge: ${battery?.charge ?? '?'} / ${battery?.capacity ?? '?'} mAh`,
        `Dock: ${snapshot?.docked ? 'docked' : 'undocked'}`,
        `Charging: ${rich(snapshot?.chargingLabel || 'unknown')}`,
        `Lock: ${rover.locked ? rich(rover.lockReason || 'locked') : 'unlocked'}`,
        `Operating mode: ${rich(snapshot?.oiMode || 'unknown')}`,
      ].join('\n').slice(0, 1024);
      const name = `${rover.needsHelp ? '🆘' : snapshot?.docked ? '🏠' : '🤖'} ${rich(rover.name, 60)}`;
      // Leave room for the header/footer and stay within Discord's single-message limits.
      if (fields.length < 25 && name.length + value.length <= budget) {
        fields.push({ name, value, inline: true });
        budget -= name.length + value.length;
      }
    }
    let content = lines.join('\n') || 'No rovers online.';
    if (content.length > 2000) content = `${content.slice(0, 1950)}\n… More rovers online.`;
    const objective = getGlobalObjective()?.text;
    return {
      content,
      allowedMentions: { parse: [] },
      embeds: [{
        title: 'Live rover status',
        color: roster.some((rover) => rover.needsHelp) ? 0xe74c3c : 0x2ecc71,
        description: [`**${rich(getMode(), 60)}** · ${roster.length} online`,
          objective ? `Objective: ${rich(objective, 300)}` : null].filter(Boolean).join('\n'),
        fields,
        footer: { text: fields.length < roster.length
          ? `${roster.length - fields.length} rover details omitted due to Discord limits · Live updates`
          : 'Live updates' },
      }],
    };
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
      lastSignature = null;
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
      const signature = JSON.stringify(report);
      const replace = signature !== lastSignature;
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
        PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks, PermissionFlagsBits.ManageMessages])) {
        throw new Error('Live status requires View Channel, Read Message History, Send Messages, Embed Links, and Manage Messages');
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
        report.embeds[0].timestamp = new Date().toISOString();
        const message = await channel.send(report);
        if (!active()) return;
        messageId = message.id;
        lastSignature = signature;
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
          subscribe('mode.changed', onChange),
          subscribe('globalObjective.updated', onChange),
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
