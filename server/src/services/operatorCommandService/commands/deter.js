// Operator Deter Command
// Purpose: Handles deterrence moderation commands for lockdown admins.
// Scope: Supports list, ban, and unban subcommands.
const { mask, normalizeSearchText, resolveIdentitySelector } = require('./resolvers');
const { getCommandConfig } = require('../../operatorCommandService/config');

function findOnlineNicknameMatches(io, getNickname, selector) {
  const normalizedSelector = normalizeSearchText(selector);
  if (!normalizedSelector) return [];

  const matchesByUserId = new Map();
  const sockets = io?.sockets?.sockets;
  if (!sockets || typeof sockets.forEach !== 'function') return [];

  sockets.forEach((socket) => {
    const nickname = getNickname(socket);
    const userId = String(socket?.data?.userId || '').trim();
    if (!userId || normalizeSearchText(nickname) !== normalizedSelector) return;

    /*
      One person may have multiple connected tabs or surfaces. Collapse those
      sockets to the canonical user id so duplicate tabs do not manufacture an
      ambiguous moderation target when they all represent the same identity.
    */
    if (!matchesByUserId.has(userId)) {
      matchesByUserId.set(userId, { userId, nickname });
    }
  });

  return Array.from(matchesByUserId.values());
}

function uniqueIdentityRecords(records = []) {
  const byIdentity = new Map();
  records.forEach((record) => {
    const key = record?.userId || record?.id || record?.cookieUserId || record?.fingerprintId;
    if (key && !byIdentity.has(key)) byIdentity.set(key, record);
  });
  return Array.from(byIdentity.values());
}

function createDeterCommand({ io, getNickname, listDeterredUsers, listMutedUsers, listVerifiedUsers, deterUser, undeterUser, muteUser, unmuteUser, sanitizeMentions, config }) {
  // Moderation usage errors use the same core prefix shown by organized help.
  const { prefix: commandPrefix } = getCommandConfig(config);

  return async function handleDeterCommand(message, tokens) {
    if (!message.actor?.isLockdownAdmin) {
      await message.reply({ content: 'Only lockdown admins can manage deterred users.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }
    const action = (tokens.shift() || 'list').toLowerCase();
    if (action === 'list') {
      const deterredUsers = listDeterredUsers().map((entry) => ({ ...entry, deterred: true }));
      const mutedUsers = listMutedUsers().map((entry) => ({ ...entry, muted: true }));
      const usersById = new Map();
      [...deterredUsers, ...mutedUsers].forEach((entry) => {
        const userId = entry.userId || entry.id;
        if (!userId) return;
        const existing = usersById.get(userId) || {};
        usersById.set(userId, {
          ...existing,
          ...entry,
          deterred: Boolean(existing.deterred || entry.deterred),
          muted: Boolean(existing.muted || entry.muted),
        });
      });
      const users = Array.from(usersById.values());
      if (!users.length) return message.reply({ content: 'No deterred or muted users.', allowedMentions: { parse: [], repliedUser: false } });
      const lines = users.map((entry, idx) => {
        const flags = [entry.deterred ? 'deterred' : '', entry.muted ? 'muted' : ''].filter(Boolean).join(', ');
        return `${idx + 1}. ${entry.userId || entry.id} | ${entry.nickname || 'unknown'} | ${flags} | ${mask(entry.cookieUserId)}`;
      });
      return message.reply({ content: ['Moderated users:', ...lines].join('\n').slice(0, 1900), allowedMentions: { parse: [], repliedUser: false } });
    }
    if (action === 'ban') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: `Usage: \`${commandPrefix} deter ban <cookieUserId|nickname|ip>\``, allowedMentions: { parse: [], repliedUser: false } });
      try {
        const onlineMatches = findOnlineNicknameMatches(io, getNickname, selector);
        if (onlineMatches.length > 1) {
          /*
            Identical live nicknames are genuinely ambiguous, so do not guess
            for a destructive command. Unlike the old generic error, this
            response exposes stable selectors that the administrator can copy
            directly into a follow-up command.
          */
          const choices = onlineMatches.map((match) => `${match.nickname} (${match.userId})`).join(', ');
          return message.reply({
            content: sanitizeMentions(`More than one online user is named ${selector}: ${choices}. Retry with \`${commandPrefix} deter ban <userId>\`.`),
            allowedMentions: { parse: [], repliedUser: false },
          });
        }

        let stableSelector = onlineMatches[0]?.userId || null;
        if (!stableSelector) {
          const verifiedMatch = resolveIdentitySelector(selector, listVerifiedUsers(), { includeId: false });
          if (verifiedMatch.error && !/not found/i.test(verifiedMatch.error)) {
            return message.reply({ content: sanitizeMentions(verifiedMatch.error), allowedMentions: { parse: [], repliedUser: false } });
          }
          stableSelector = verifiedMatch.record?.userId || verifiedMatch.record?.id || verifiedMatch.record?.cookieUserId || selector;
        }
        // Ban reasons were deliberately removed from the command grammar. The
        // full remaining text is now always the selector, which lets lockdown
        // admins deter multi-word nicknames without quoting or delimiter rules.
        const deterred = deterUser(stableSelector, { actor: message.actor?.id || null });
        return message.reply({ content: sanitizeMentions(`${deterred.created ? 'Deterred' : 'Updated deterrence for'} ${deterred.nickname || 'unknown'} (${mask(deterred.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to deter user: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    if (action === 'unban') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: `Usage: \`${commandPrefix} deter unban <id|cookieUserId|nickname|ip>\``, allowedMentions: { parse: [], repliedUser: false } });
      try {
        const resolved = resolveIdentitySelector(selector, listDeterredUsers(), { includeId: true });
        if (resolved.error) return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: { parse: [], repliedUser: false } });
        const removed = undeterUser(resolved.record.id || resolved.record.cookieUserId || selector, message.actor?.id || null);
        return message.reply({ content: sanitizeMentions(`Removed deterrence for ${removed.nickname || 'unknown'} (${mask(removed.cookieUserId)}).`), allowedMentions: { parse: [], repliedUser: false } });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to remove deterrence: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    if (action === 'mute' || action === 'unmute') {
      const selector = tokens.join(' ').trim();
      if (!selector) return message.reply({ content: `Usage: \`${commandPrefix} deter ${action} <userId|cookieUserId|nickname|ip>\``, allowedMentions: { parse: [], repliedUser: false } });
      try {
        const onlineMatches = findOnlineNicknameMatches(io, getNickname, selector);
        if (onlineMatches.length > 1) {
          const choices = onlineMatches.map((match) => `${match.nickname} (${match.userId})`).join(', ');
          return message.reply({
            content: sanitizeMentions(`More than one online user is named ${selector}: ${choices}. Retry with \`${commandPrefix} deter ${action} <userId>\`.`),
            allowedMentions: { parse: [], repliedUser: false },
          });
        }

        let stableSelector = onlineMatches[0]?.userId || null;
        if (!stableSelector) {
          const storedCandidates = uniqueIdentityRecords([...listVerifiedUsers(), ...listMutedUsers()]);
          const storedMatch = resolveIdentitySelector(selector, storedCandidates, { includeId: true });
          if (storedMatch.error && !/not found/i.test(storedMatch.error)) {
            return message.reply({ content: sanitizeMentions(storedMatch.error), allowedMentions: { parse: [], repliedUser: false } });
          }
          /*
            Unverified users may not appear in the convenience candidate list.
            Passing the original exact selector through lets verificationService
            resolve any canonical identity without making fuzzy guesses here.
          */
          stableSelector = storedMatch.record?.userId || storedMatch.record?.id || storedMatch.record?.cookieUserId || selector;
        }

        const updated = action === 'mute'
          ? muteUser(stableSelector, message.actor?.id || null)
          : unmuteUser(stableSelector, message.actor?.id || null);
        return message.reply({
          content: sanitizeMentions(`${action === 'mute' ? 'Muted' : 'Unmuted'} ${updated.nickname || 'unknown'} (${mask(updated.cookieUserId)}).`),
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Failed to ${action} user: ${err.message}`), allowedMentions: { parse: [], repliedUser: false } });
      }
    }
    return message.reply({ content: `Unknown deter command. Use \`${commandPrefix} deter list\`, \`${commandPrefix} deter ban <selector>\`, \`${commandPrefix} deter unban <selector>\`, \`${commandPrefix} deter mute <selector>\`, or \`${commandPrefix} deter unmute <selector>\`.`, allowedMentions: { parse: [], repliedUser: false } });
  };
}

module.exports = { createDeterCommand, findOnlineNicknameMatches, uniqueIdentityRecords };
