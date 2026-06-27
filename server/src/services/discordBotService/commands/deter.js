// Discord Deter Command
// Purpose: Handles deterrence moderation commands for lockdown admins.
// Scope: Supports list, ban, and unban subcommands.
const { mask, resolveIdentitySelector } = require('./resolvers');

function createDeterCommand({ listDeterredUsers, listVerifiedUsers, deterUser, undeterUser, isLockdownAdminUser, sanitizeMentions }) {

  return async function handleDeterCommand(message, tokens) {
    if (!isLockdownAdminUser(message.author?.id)) {
      await message.reply({ content: 'Only lockdown admins can manage deterred users.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const action = (tokens.shift() || 'list').toLowerCase();
    if (action === 'list') {
      const users = listDeterredUsers();
      if (!users.length) return message.reply({ content: 'No deterred users.', allowedMentions: { parse: [], repliedUser: false } });
      const lines = users.map((entry, idx) => `${idx + 1}. ${entry.userId || entry.id} | ${entry.nickname || 'unknown'} | ${mask(entry.cookieUserId)}`);
      return message.reply({ content: ['Deterred users:', ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
    }
    if (action === 'ban') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: 'Usage: `rs deter ban <cookieUserId|nickname|ip>`', allowedMentions: { parse: [], repliedUser: false } });
      try {
        const verifiedMatch = resolveIdentitySelector(selector, listVerifiedUsers(), { includeId: false });
        if (verifiedMatch.error && !/not found/i.test(verifiedMatch.error)) {
          return message.reply({ content: sanitizeMentions(verifiedMatch.error), allowedMentions: { parse: [], repliedUser: false } });
        }
        // Ban reasons were deliberately removed from the command grammar. The
        // full remaining text is now always the selector, which lets lockdown
        // admins deter multi-word nicknames without quoting or delimiter rules.
        const stableSelector = verifiedMatch.record?.userId || verifiedMatch.record?.id || verifiedMatch.record?.cookieUserId || selector;
        const deterred = deterUser(stableSelector, { actor: message.author?.id || null });
        return message.reply({ content: sanitizeMentions(`${deterred.created ? 'Deterred' : 'Updated deterrence for'} ${deterred.nickname || 'unknown'} (${mask(deterred.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to deter user: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    if (action === 'unban') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: 'Usage: `rs deter unban <id|cookieUserId|nickname|ip>`', allowedMentions: { parse: [], repliedUser: false } });
      try {
        const resolved = resolveIdentitySelector(selector, listDeterredUsers(), { includeId: true });
        if (resolved.error) return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
        const removed = undeterUser(resolved.record.id || resolved.record.cookieUserId || selector, message.author?.id || null);
        return message.reply({ content: sanitizeMentions(`Removed deterrence for ${removed.nickname || 'unknown'} (${mask(removed.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to remove deterrence: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    return message.reply({ content: 'Unknown deter command. Use `rs deter list`, `rs deter ban <selector>`, or `rs deter unban <selector>`.', allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createDeterCommand };
