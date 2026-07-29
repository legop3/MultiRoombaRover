// Operator Gain Command
// Purpose: Handles the audio gain boost permission for VIPs.
// Scope: Supports list, grant, and revoke subcommands; resolution stays VIP-only.
const { mask, normalizeSearchText, resolveIdentitySelector } = require('./resolvers');
const { getCommandConfig } = require('../../operatorCommandService/config');

/*
  Every connected socket's canonical user id. One person can hold several sockets
  across tabs, so this is a set of identities rather than a count of connections.
*/
function collectOnlineUserIds(io) {
  const online = new Set();
  const sockets = io?.sockets?.sockets;
  if (!sockets || typeof sockets.forEach !== 'function') return online;
  sockets.forEach((socket) => {
    const userId = String(socket?.data?.userId || '').trim();
    if (userId) online.add(userId);
  });
  return online;
}

/*
  Candidates whose identity fields equal the selector outright. Nicknames are not
  unique — the same person re-verifying from a new browser produces a second
  verified record with the same name — so an exact nickname match can legitimately
  return several records.
*/
function findExactMatches(selector, candidates) {
  const needle = normalizeSearchText(selector);
  if (!needle) return [];
  return (Array.isArray(candidates) ? candidates : []).filter((record) => (
    normalizeSearchText(record?.nickname) === needle
    || normalizeSearchText(record?.userId) === needle
    || normalizeSearchText(record?.id) === needle
    || normalizeSearchText(record?.cookieUserId) === needle
    || normalizeSearchText(record?.fingerprintId) === needle
  ));
}

function createGainCommand({
  io,
  listVerifiedUsers,
  listAudioGainBoostUsers,
  grantAudioGainBoost,
  revokeAudioGainBoost,
  sanitizeMentions,
  config,
}) {
  // Usage text comes from the same core prefix that both transports parse.
  const { prefix: commandPrefix } = getCommandConfig(config);
  const plain = { parse: [], repliedUser: false };

  function usage(subcommand) {
    return `Usage: \`${commandPrefix} gain ${subcommand} <nickname|userId|cookieUserId>\``;
  }

  /*
    Duplicate nicknames used to make `gain grant <name>` unusable: the shared
    resolver refuses on ambiguity, which is right for destructive commands like
    deter and kick but wrong here. Granting a volume ceiling to the wrong one of
    two accounts belonging to the same person is recoverable, so this command
    picks one and says which.

    The online account wins, because that is who the admin is reacting to. With
    nobody online the first stored record is used. The shared fuzzy resolver still
    handles the no-exact-match case so typo tolerance and its error text are
    unchanged.
  */
  function resolveBoostTarget(selector, candidates) {
    const exact = findExactMatches(selector, candidates);
    if (exact.length === 1) return { record: exact[0] };

    if (exact.length > 1) {
      const onlineUserIds = collectOnlineUserIds(io);
      const onlineMatches = exact.filter((record) => {
        const userId = String(record?.userId || '').trim();
        return userId && onlineUserIds.has(userId);
      });
      if (onlineMatches.length) {
        return { record: onlineMatches[0], duplicates: exact.length, picked: 'online' };
      }
      return { record: exact[0], duplicates: exact.length, picked: 'first' };
    }

    return resolveIdentitySelector(selector, candidates, { includeId: false });
  }

  function describePick(resolved) {
    if (!resolved.duplicates) return '';
    if (resolved.picked === 'online') {
      return ` ${resolved.duplicates} accounts share that name; picked the one that is online.`;
    }
    return ` ${resolved.duplicates} accounts share that name and none are online; picked the first.`;
  }

  function helpText() {
    return [
      '**Audio gain boost**',
      'Raises a user\'s volume ceiling past the global gains, still bounded by the hard caps.',
      '',
      `\`${commandPrefix} gain list\` — show everyone who holds the boost.`,
      `\`${commandPrefix} gain grant <vip>\` — give the boost to a verified user.`,
      `\`${commandPrefix} gain revoke <vip>\` — take the boost away.`,
      `\`${commandPrefix} gain help\` — show this.`,
      '',
      'A user can be named by nickname, userId, or cookieUserId. Only verified (VIP)',
      'users can be granted the boost. If several accounts share a nickname, the one',
      'that is currently online is used.',
    ].join('\n');
  }

  /*
    The boost is a VIP-only permission, so candidate matching runs against the
    verified list rather than every known identity. A nickname that only belongs
    to an unverified visitor therefore reports "not found" instead of resolving
    to someone who cannot hold the flag anyway.
  */
  async function applyBoost(message, tokens, enabled) {
    const selector = tokens.join(' ').trim();
    if (!selector) {
      return message.reply({ content: usage(enabled ? 'grant' : 'revoke'), allowedMentions: plain });
    }
    const candidates = enabled ? listVerifiedUsers() : listAudioGainBoostUsers();
    const resolved = resolveBoostTarget(selector, candidates);
    if (resolved.error) {
      return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: plain });
    }
    const target = resolved.record.userId || resolved.record.id || resolved.record.cookieUserId;
    try {
      const actor = message.actor?.id || null;
      const user = enabled ? grantAudioGainBoost(target, actor) : revokeAudioGainBoost(target, actor);
      const verb = enabled ? 'Granted' : 'Revoked';
      return message.reply({
        content: sanitizeMentions(`${verb} audio gain boost for ${user.nickname || 'unknown'} (${mask(user.cookieUserId)}).${describePick(resolved)}`),
        allowedMentions: plain,
      });
    } catch (err) {
      return message.reply({
        content: sanitizeMentions(`Failed to update audio gain boost: ${err.message}`),
        allowedMentions: plain,
      });
    }
  }

  return async function handleGainCommand(message, tokens) {
    if (!message.actor?.isAdmin) {
      await message.reply({ content: 'Only admins can manage audio gain boosts.', allowedMentions: plain });
      return;
    }
    const action = (tokens.shift() || 'list').toLowerCase();

    if (action === 'help') {
      return message.reply({ content: helpText(), allowedMentions: plain });
    }

    if (action === 'list') {
      const users = listAudioGainBoostUsers();
      if (!users.length) {
        return message.reply({ content: 'No users hold an audio gain boost.', allowedMentions: plain });
      }
      const lines = users.map((entry, idx) => (
        `${idx + 1}. ${entry.nickname || 'unknown'} | ${entry.userId || entry.id} | ${mask(entry.cookieUserId)}`
      ));
      return message.reply({
        content: sanitizeMentions(['Audio gain boost holders:', ...lines].join('\n').slice(0, 1900)),
        allowedMentions: plain,
      });
    }

    if (action === 'grant') return applyBoost(message, tokens, true);
    if (action === 'revoke') return applyBoost(message, tokens, false);

    return message.reply({
      content: `Unknown gain command.\n${helpText()}`,
      allowedMentions: plain,
    });
  };
}

module.exports = { createGainCommand };
