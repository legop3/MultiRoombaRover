// Discord Integrations Helpers
// Purpose: Shared helper functions for Discord event integrations.
// Scope: Formatting and identity helpers used across integration handlers.
function sanitizeMentions(text) {
  if (!text) return '';
  return String(text).replace(/<(@[!&]?\d+|#\d+)>/g, '[ping removed]').replace(/@everyone/gi, '[everyone]').replace(/@here/gi, '[here]');
}

function formatDuration(ms) {
  if (ms == null) return 'n/a';
  const seconds = Math.max(0, Math.round(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  if (minutes <= 0) return `${seconds}s`;
  return remainder > 0 ? `${minutes}m ${remainder}s` : `${minutes}m`;
}

function formatWebhookUsername(payload) {
  const name = payload.nickname || payload.socketId?.slice(0, 6) || 'unknown';
  if (payload.fromDiscord) {
    const origin = payload.discordGuildName ? ` (From: ${payload.discordGuildName})` : '';
    const adminTag = payload.role === 'admin' || payload.role === 'lockdown' || payload.role === 'lockdown-admin' ? ' [Rover Admin]' : '';
    return `${name}${origin}${adminTag}`;
  }
  const roverText = payload.roverId ? `Rover: ${payload.roverId}` : `No rover`;
  const roleText = payload.role === 'admin' || payload.role === 'lockdown' || payload.role === 'lockdown-admin' ? 'Admin' : null;
  const suffix = [roverText, roleText].filter(Boolean).join(' · ');
  return suffix ? `${name} · ${suffix}` : name;
}

function getTypingId(payload = {}) {
  if (payload.typingId) return payload.typingId;
  if (payload.fromDiscord) return payload.discordUserId ? `discord:${payload.discordUserId}` : 'discord:unknown';
  if (payload.socketId) return `socket:${payload.socketId}`;
  return payload.nickname ? `socket:${payload.nickname}` : 'socket:unknown';
}

module.exports = {
  sanitizeMentions,
  formatDuration,
  formatWebhookUsername,
  getTypingId,
};
