// Discord Deter Command
// Purpose: Handles deterrence moderation commands for lockdown admins.
// Scope: Supports list, ban, and unban subcommands.
function createDeterCommand({ listDeterredUsers, deterUser, undeterUser, isLockdownAdminUser, sanitizeMentions }) {
  function mask(v) {
    const key = String(v || '').trim();
    if (!key) return 'n/a';
    if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
    return `${key.slice(0, 6)}...${key.slice(-6)}`;
  }

  return async function handleDeterCommand(message, tokens) {
    if (!isLockdownAdminUser(message.author?.id)) {
      await message.reply({ content: 'Only lockdown admins can manage deterred users.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const action = (tokens.shift() || 'list').toLowerCase();
    if (action === 'list') {
      const users = listDeterredUsers();
      if (!users.length) return message.reply({ content: 'No deterred users.', allowedMentions: { parse: [], repliedUser: false } });
      const lines = users.map((entry, idx) => `${idx + 1}. ${entry.id} | ${entry.nickname || 'unknown'} | ${mask(entry.cookieUserId)}`);
      return message.reply({ content: ['Deterred users:', ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
    }
    if (action === 'ban') {
      const selector = String(tokens.shift() || '').trim();
      const reason = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: 'Usage: `rs deter ban <cookieUserId|nickname|ip> [reason]`', allowedMentions: { parse: [], repliedUser: false } });
      try {
        const deterred = deterUser(selector, { reason, actor: message.author?.id || null });
        return message.reply({ content: sanitizeMentions(`${deterred.created ? 'Deterred' : 'Updated deterrence for'} ${deterred.nickname || 'unknown'} (${mask(deterred.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to deter user: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    if (action === 'unban') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: 'Usage: `rs deter unban <id|cookieUserId|nickname|ip>`', allowedMentions: { parse: [], repliedUser: false } });
      try {
        const removed = undeterUser(selector, message.author?.id || null);
        return message.reply({ content: sanitizeMentions(`Removed deterrence for ${removed.nickname || 'unknown'} (${mask(removed.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to remove deterrence: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    return message.reply({ content: 'Unknown deter command. Use `rs deter list`, `rs deter ban <selector> [reason]`, or `rs deter unban <selector>`.', allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createDeterCommand };
