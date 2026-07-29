// Operator Gain Command
// Purpose: Handles the audio gain boost permission for VIPs.
// Scope: Supports list, grant, and revoke subcommands; resolution stays VIP-only.
const { mask, resolveIdentitySelector } = require('./resolvers');
const { getCommandConfig } = require('../../operatorCommandService/config');

function createGainCommand({
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
    const resolved = resolveIdentitySelector(selector, candidates, { includeId: false });
    if (resolved.error) {
      return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: plain });
    }
    const target = resolved.record.userId || resolved.record.id || resolved.record.cookieUserId;
    try {
      const actor = message.actor?.id || null;
      const user = enabled ? grantAudioGainBoost(target, actor) : revokeAudioGainBoost(target, actor);
      const verb = enabled ? 'Granted' : 'Revoked';
      return message.reply({
        content: sanitizeMentions(`${verb} audio gain boost for ${user.nickname || 'unknown'} (${mask(user.cookieUserId)}).`),
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
      content: `Unknown gain command. Use \`${commandPrefix} gain list\`, \`${commandPrefix} gain grant <vip>\`, or \`${commandPrefix} gain revoke <vip>\`.`,
      allowedMentions: plain,
    });
  };
}

module.exports = { createGainCommand };
