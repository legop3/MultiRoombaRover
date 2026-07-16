// Discord Command Adapter
// Purpose: Supplies Discord-specific renderers and extension commands to the operator command service.
// Scope: Keeps Discord embeds, attachments, guild permissions, and bridge context outside the shared command core.
const { createStatusCommand } = require('./commands/status');
const { createReplayCommand } = require('./commands/replay');
const { createBridgeCommand } = require('./commands/bridge');
const { createTimeStatusCommand } = require('./commands/timeStatus');

function createDiscordTransportHandlers(deps) {
  const status = createStatusCommand(deps);
  const replay = createReplayCommand(deps);
  const bridge = createBridgeCommand(deps);
  const timeStatus = createTimeStatusCommand(deps);
  return {
    status: (request, query) => status(request.context.discordMessage, query),
    replay: (request, query) => replay(request.context.discordMessage, query),
    bridge: (request, tokens) => bridge(request.context.discordMessage, tokens),
    timeStatus: (request) => timeStatus(request.context.discordMessage),
  };
}

function createDiscordCommandRequest(message, { isAdminUser, isLockdownAdminUser }) {
  const id = message.author?.id || null;
  return {
    content: String(message.content || ''),
    transport: 'discord',
    actor: {
      id,
      label: message.member?.nickname || message.author?.globalName || message.author?.username || 'Discord',
      bot: Boolean(message.author?.bot),
      isAdmin: isAdminUser(id),
      isLockdownAdmin: isLockdownAdminUser(id),
    },
    reply: (payload) => message.reply(payload),
    context: { discordMessage: message },
  };
}

module.exports = { createDiscordTransportHandlers, createDiscordCommandRequest };
