// Operator Permissions Command
// Purpose: Lets administrators inspect and change registered positive user capabilities.
// Scope: Resolves canonical users and delegates persistence to identityService without embedding feature-specific permission logic.
const { mask, resolveIdentitySelector } = require('./resolvers');
const { getCommandConfig } = require('../config');

function commandCandidates(users = []) {
  return users.map((user) => ({
    ...user,
    userId: user.id,
    cookieUserId: user.cookieUserIds?.[0] || null,
    fingerprintId: user.fingerprintIds?.[0] || null,
  }));
}

function createPermissionsCommand({
  listUsersForAdmin,
  listUsersWithPermission,
  listRegisteredPermissions,
  setUserPermission,
  sanitizeMentions,
  config,
}) {
  const { prefix } = getCommandConfig(config);
  const plain = { parse: [], repliedUser: false };

  function helpText() {
    return [
      '**User permissions**',
      `- \`${prefix} permissions\`: list available permissions.`,
      `- \`${prefix} permissions list <permission>\`: list users with a permission.`,
      `- \`${prefix} permissions grant <permission> <user>\`: grant a permission.`,
      `- \`${prefix} permissions revoke <permission> <user>\`: revoke a permission.`,
    ].join('\n');
  }

  function resolvePermission(selector) {
    const needle = String(selector || '').trim().toLowerCase();
    return listRegisteredPermissions().find((permission) => (
      permission.key.toLowerCase() === needle || permission.commandName.toLowerCase() === needle
    )) || null;
  }

  return async function handlePermissionsCommand(message, tokens = []) {
    if (!message.actor?.isAdmin) {
      return message.reply({ content: 'Only admins can manage user permissions.', allowedMentions: plain });
    }

    const action = (tokens.shift() || 'help').toLowerCase();
    if (action === 'help') return message.reply({ content: helpText(), allowedMentions: plain });

    if (action !== 'list' && action !== 'grant' && action !== 'revoke') {
      return message.reply({ content: `Unknown permissions command.\n${helpText()}`, allowedMentions: plain });
    }

    const permissionSelector = tokens.shift();
    if (!permissionSelector && action === 'list') {
      const lines = listRegisteredPermissions().map((permission) => (
        `- \`${permission.commandName}\`: ${permission.description}`
      ));
      return message.reply({ content: ['Registered user permissions:', ...lines].join('\n'), allowedMentions: plain });
    }

    const permission = resolvePermission(permissionSelector);
    if (!permission) {
      return message.reply({ content: `Unknown permission. Use \`${prefix} permissions list\` to see valid names.`, allowedMentions: plain });
    }

    if (action === 'list') {
      const users = listUsersWithPermission(permission.key);
      if (!users.length) return message.reply({ content: `No users have ${permission.label}.`, allowedMentions: plain });
      const lines = users.map((user, index) => (
        `${index + 1}. ${user.nickname || 'unknown'} | ${user.id} | ${mask(user.cookieUserIds?.[0])}`
      ));
      return message.reply({
        content: sanitizeMentions([`${permission.label}:`, ...lines].join('\n').slice(0, 1900)),
        allowedMentions: plain,
      });
    }

    const selector = tokens.join(' ').trim();
    if (!selector) {
      return message.reply({
        content: `Usage: \`${prefix} permissions ${action} ${permission.commandName} <user>\``,
        allowedMentions: plain,
      });
    }

    const resolved = resolveIdentitySelector(selector, commandCandidates(listUsersForAdmin()));
    if (resolved.error) return message.reply({ content: sanitizeMentions(resolved.error), allowedMentions: plain });

    try {
      const user = setUserPermission(resolved.record.id, permission.key, {
        enabled: action === 'grant',
        actor: message.actor?.id || null,
        at: Date.now(),
      });
      return message.reply({
        content: sanitizeMentions(`${action === 'grant' ? 'Granted' : 'Revoked'} ${permission.label} for ${user.nickname || 'unknown'} (${user.id}).`),
        allowedMentions: plain,
      });
    } catch (err) {
      return message.reply({ content: sanitizeMentions(`Permission update failed: ${err.message}`), allowedMentions: plain });
    }
  };
}

module.exports = { createPermissionsCommand };
