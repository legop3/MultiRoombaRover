// Discord Replay Command
// Purpose: Handles replay capture requests from Discord.
// Scope: Resolves source selectors, enforces cooldowns, and replies with replay video attachment.
const { AttachmentBuilder } = require('discord.js');
const io = require('../../../globals/io');

function createReplayCommand({ getMode, MODES, tryTriggerReplay, getReplaySources, getDefaultDiscordSources, validateSources, buildReplayVideo, sanitizeMentions, getActiveDrivers, getNickname, rovers }) {
  function normalizeReplayQuery(input) { return String(input || '').trim().toLowerCase(); }
  function sanitizeReplayTitleForFilename(title) {
    const cleaned = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    return cleaned || 'replay';
  }
  function buildDefaultReplayTitle(requester, sources = []) {
    const requesterLabel = String(requester || 'Someone').trim() || 'Someone';
    const roverSource = (Array.isArray(sources) ? sources : []).find((entry) => entry?.type === 'rover');
    const roverLabel = roverSource?.label || roverSource?.id || 'a rover';
    return `${requesterLabel} driving ${roverLabel}`;
  }

  function buildReplayDriverLines(requester, sources = []) {
    const activeDrivers = getActiveDrivers();
    const roverSources = (Array.isArray(sources) ? sources : []).filter((entry) => entry?.type === 'rover');
    const requestedRoverIds = new Set(roverSources.map((entry) => String(entry.id)));
    const lines = [];
    requestedRoverIds.forEach((roverId) => {
      const socketId = activeDrivers?.[roverId];
      if (!socketId) return;
      const socket = io.sockets.sockets.get(socketId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || socketId;
      const record = rovers.get(roverId);
      const roverName = record?.meta?.name || record?.id || roverId;
      const isAuthor = String(nickname).toLowerCase() === String(requester || '').toLowerCase();
      lines.push(`${nickname} driving ${roverName}${isAuthor ? ' **author**' : ''}`);
    });
    return lines;
  }

  function buildDriverCaption() {
    const activeDrivers = getActiveDrivers();
    const roster = Array.from(rovers.values());
    if (!roster.length) return 'Drivers: no rovers online.';
    const entries = roster.map((record) => {
      const driverId = activeDrivers[record.id];
      if (!driverId) return `${record.meta?.name || record.id}: none`;
      const socket = io.sockets.sockets.get(driverId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || driverId;
      return `${record.meta?.name || record.id}: ${nickname}`;
    });
    return `Drivers: ${entries.join(', ')}`;
  }

  function buildReplayCaption({ requester, usedSources = [], missingSources = [], title }) {
    const lines = [];
    if (title) {
      lines.push(`**${title}**`);
      lines.push('');
    }
    const driverLines = buildReplayDriverLines(requester, usedSources);
    if (driverLines.length) lines.push(...driverLines);
    if (missingSources.length) {
      if (driverLines.length) lines.push('');
      lines.push(`Missing: ${missingSources.map((source) => source.label || `${source.type}:${source.id}`).join(', ')}`);
    }
    if (!lines.length) lines.push(buildDriverCaption());
    return lines.join('\n');
  }
  function resolveReplaySources(query) {
    const cleaned = normalizeReplayQuery(query);
    if (!cleaned || cleaned === 'all' || cleaned === '*') return { sources: getDefaultDiscordSources() };
    const tokens = cleaned.split(',').map((token) => token.trim()).filter(Boolean);
    const all = getReplaySources();
    const matches = [];
    tokens.forEach((token) => {
      const [prefix, rest] = token.includes(':') ? token.split(':', 2) : [null, token];
      const candidate = all.find((entry) => (String(entry.id).toLowerCase() === rest || String(entry.label || '').toLowerCase() === rest) && (!prefix || entry.type === prefix));
      if (candidate) matches.push({ type: candidate.type, id: candidate.id, label: candidate.label });
    });
    const sources = validateSources(matches);
    return sources.length ? { sources } : { error: 'No matching sources found', matches: [] };
  }

  return async function handleReplayCommand(message, query) {
    if (getMode() === MODES.LOCKDOWN) {
      await message.reply({ content: 'Replay is disabled while the server is in lockdown.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const attempt = tryTriggerReplay({ by: message.author?.id || null, source: 'discord' });
    if (!attempt.ok) {
      await message.reply({ content: `Replay cooldown active. Try again in ${Math.ceil(attempt.remainingMs / 1000)}s.`, allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const resolved = resolveReplaySources(query);
    if (resolved?.error) {
      await message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const requester = message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord';
    const title = buildDefaultReplayTitle(requester, resolved.sources || []);
    try {
      const { buffer, usedSources = resolved.sources || [], missingSources = [] } = await buildReplayVideo({
        sources: resolved.sources || [],
        title,
        requester,
      });
      const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(title)}.mp4` });
      const body = buildReplayCaption({ requester, usedSources, missingSources, title });
      await message.reply({ content: sanitizeMentions(body), files: [attachment], allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Replay failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createReplayCommand };
