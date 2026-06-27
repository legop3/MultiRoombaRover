// Discord Verify Command
// Purpose: Handles verified-user moderation commands for lockdown admins.
// Scope: Supports list and remove subcommands.
const { mask, resolveIdentitySelector } = require('./resolvers');

function createVerifyCommand({ listVerifiedUsers, removeVerifiedUser, isLockdownAdminUser, sanitizeMentions }) {
  return async function handleVerifyCommand(message, tokens) {
    if (!isLockdownAdminUser(message.author?.id)) {
      await message.reply({ content: 'Only lockdown admins can manage verified users.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const action = (tokens.shift() || 'list').toLowerCase();
    if (action === 'list') {
      const users = listVerifiedUsers();
      if (!users.length) return message.reply({ content: 'No verified users.', allowedMentions: { parse: [], repliedUser: false } });
      const lines = users.map((entry, idx) => `${idx + 1}. ${entry.nickname || 'unknown'} | ${entry.userId || entry.id} | ${mask(entry.cookieUserId)}`);
      return message.reply({ content: ['Verified users:', ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
    }
    if (action === 'remove') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: 'Usage: `rs verify remove <cookieUserId|nickname>`', allowedMentions: { parse: [], repliedUser: false } });
      try {
        const resolved = resolveIdentitySelector(selector, listVerifiedUsers(), { includeId: false });
        if (resolved.error) return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
        // The verification service owns the actual removal and event emission.
        // The command resolver only turns a human-friendly or fuzzy nickname
        // into the stable cookie id so the service does not need Discord/Web
        // command concerns baked into its storage API.
        const removed = removeVerifiedUser(resolved.record.userId || resolved.record.id || resolved.record.cookieUserId, message.author?.id || null);
        return message.reply({ content: `Removed verified user ${sanitizeMentions(removed.nickname || 'unknown')} (${mask(removed.cookieUserId)}).`, allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to remove verified user: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    return message.reply({ content: 'Unknown verify command. Use `rs verify list` or `rs verify remove <cookieUserId|nickname>`.', allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createVerifyCommand };
