// Discord Mode Command
// Purpose: Handles `rs mode` updates from Discord admins.
// Scope: Validates mode values and applies mode changes with optional reason text.
function createModeCommand({ MODES, setMode, setAdminReason, isLockdownAdminUser, sanitizeMentions }) {
  return async function handleModeCommand(message, tokens = []) {
    const next = String(tokens.shift() || '').toLowerCase();
    const reasonText = tokens.join(' ').trim();
    if (!Object.values(MODES).includes(next)) {
      await message.reply({ content: 'Invalid mode. Use one of: open, turns, admin, lockdown.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    try {
      const role = isLockdownAdminUser(message.author?.id) ? 'lockdown' : 'admin';
      setMode(next, { data: { role, user: { username: `discord:${message.author?.username || 'unknown'}` } } });
      if (reasonText) setAdminReason(reasonText, { by: message.author?.id || null });
      await message.reply({ content: sanitizeMentions(`Mode set to ${next}.`), allowedMentions: { parse: [], repliedUser: false } });
    } catch (err) {
      await message.reply({ content: sanitizeMentions(`Failed to set mode: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
    }
  };
}

module.exports = { createModeCommand };
