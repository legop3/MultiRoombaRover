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
  const botTag = payload.bot ? ' [BOT]' : '';
  const spectatorTag = payload.role === 'spectator' && !payload.bot ? ' [SPECTATOR]' : '';
  const adminTag = payload.role === 'admin' || payload.role === 'lockdown' ? ' [Rover Admin]' : '';
  if (payload.fromDiscord) {
    const origin = payload.discordGuildName ? ` (From: ${payload.discordGuildName})` : '';
    return `${name}${origin}${botTag}${spectatorTag}${adminTag}`;
  }
  /*
    The chat payload already carries the resolved display name for rover-like
    targets. Prefer that name so PTZ, which is intentionally pretending to be a
    rover in chat, shows up as "PTZ Camera" instead of the internal id
    "ptz-camera"; fall back to the id for older payloads or missing metadata.
  */
  const roverTagLabel = payload.roverName || payload.roverId;
  const roverTag = payload.roverId ? ` [${roverTagLabel}]` : '';
  return `${name}${botTag}${spectatorTag}${adminTag}${roverTag}`;
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
