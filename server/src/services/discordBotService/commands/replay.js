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
    const labels = (Array.isArray(sources) ? sources : [])
      .map((entry) => String(entry?.label || entry?.id || '').trim())
      .filter(Boolean);
    if (!labels.length) return `${requesterLabel} replay`;
    if (labels.length === 1) return `${requesterLabel} replay: ${labels[0]}`;
    return `${requesterLabel} replay: ${labels.slice(0, 3).join(' + ')}`;
  }

  function buildDriverSummary(sources = []) {
    const activeDrivers = getActiveDrivers();
    const roverSources = (Array.isArray(sources) ? sources : []).filter((entry) => entry?.type === 'rover');
    const lines = [];
    roverSources.forEach((source) => {
      const roverId = String(source.id);
      const socketId = activeDrivers?.[roverId];
      if (!socketId) return;
      const socket = io.sockets.sockets.get(socketId);
      const nickname = getNickname(socket) || socket?.data?.user?.username || socketId;
      const record = rovers.get(roverId);
      const roverName = record?.meta?.name || source?.label || roverId;
      lines.push(`${nickname} → ${roverName}`);
    });
    if (!lines.length) return '';
    return `Drivers: ${lines.join(' | ')}`;
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
      const { buffer } = await buildReplayVideo({ sources: resolved.sources || [], title, requester });
      const attachment = new AttachmentBuilder(buffer, { name: `${sanitizeReplayTitleForFilename(title)}.mp4` });
      const summary = buildDriverSummary(resolved.sources || []);
      const body = [ `**${title}**`, summary ].filter(Boolean).join('\n');
      await message.reply({ content: sanitizeMentions(body), files: [attachment], allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Replay failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createReplayCommand };
