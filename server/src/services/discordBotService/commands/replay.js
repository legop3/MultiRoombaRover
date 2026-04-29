// Discord Replay Command
// Purpose: Handles replay capture requests from Discord.
// Scope: Resolves source selectors, enforces cooldowns, and replies with replay video attachment.
const { AttachmentBuilder } = require('discord.js');

function createReplayCommand({ getMode, MODES, tryTriggerReplay, getReplaySources, getDefaultDiscordSources, validateSources, buildReplayVideo, sanitizeMentions }) {
  function normalizeReplayQuery(input) { return String(input || '').trim().toLowerCase(); }
  function sanitizeReplayTitleForFilename(title) {
    const cleaned = String(title || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 96);
    return cleaned || 'replay';
  }
  function buildDefaultReplayTitle(requester, sources = []) {
    const roverSource = sources.find((entry) => entry?.type === 'rover');
    return `${String(requester || 'Someone').trim() || 'Someone'} driving ${roverSource?.label || roverSource?.id || 'a rover'}`;
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
      await message.reply({ content: sanitizeMentions(`**${title}**`), files: [attachment], allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Replay failed: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createReplayCommand };
