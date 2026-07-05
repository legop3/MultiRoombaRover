// Discord Commands Router
// Purpose: Routes incoming Discord command messages to one-file-per-command handlers.
// Scope: Central command dispatcher and permission gate orchestration.
const { formatHelp } = require('./help');
const { createStatusCommand } = require('./status');
const { createReplayCommand } = require('./replay');
const { createLockCommand } = require('./lock');
const { createModeCommand } = require('./mode');
const { createReasonCommand } = require('./reason');
const { createGoalCommand } = require('./goal');
const { createVerifyCommand } = require('./verify');
const { createDeterCommand } = require('./deter');
const { createBridgeCommand } = require('./bridge');
const { createTimeStatusCommand } = require('./timeStatus');
const { createLightsCommand } = require('./lights');

function createCommandHandlers(deps) {
  const {
    getMode,
    MODES,
    isAdminUser,
    isLockdownAdminUser,
  } = deps;

  const handleStatusCommand = createStatusCommand(deps);
  const handleReplayCommand = deps.createReplayTextCommand
    ? deps.createReplayTextCommand(deps)
    : createReplayCommand(deps);
  const handleLockCommand = createLockCommand(deps);
  const handleModeCommand = createModeCommand(deps);
  const handleReasonCommand = createReasonCommand(deps);
  const handleGoalCommand = createGoalCommand(deps);
  const handleVerifyCommand = createVerifyCommand(deps);
  const handleDeterCommand = createDeterCommand(deps);
  const handleBridgeCommand = createBridgeCommand(deps);
  const handleTimeStatusCommand = createTimeStatusCommand(deps);
  const handleLightsCommand = createLightsCommand(deps);

  async function handleCommand(message) {
    if (message.author.bot) return;
    const content = (message.content || '').trim();
    const lower = content.toLowerCase();
    // Commands are intentionally matched as whole prefixes. The previous
    // startsWith checks made ordinary messages such as "rsvp" or "tshirt" look
    // like commands, which is especially bad now that web chat will run the
    // same server-side dispatcher before broadcasting user text.
    if (lower === 'ts') return handleTimeStatusCommand(message);
    if (!/^rs(?:\s|$)/i.test(content)) return;

    const tokens = content.split(/\s+/);
    tokens.shift();
    const action = (tokens.shift() || '').toLowerCase();
    const rest = tokens.join(' ').trim();
    const isAdmin = isAdminUser(message.author.id);
    const isLockdownAdmin = isLockdownAdminUser(message.author.id);
    const mode = getMode();
    // Actions in this set can change operational safety or access policy, so
    // lockdown mode narrows them from normal admins to lockdown admins. Room
    // light locking belongs here because it can force the physical room lights
    // on and disables ordinary Home Assistant room controls for everyone else.
    const moderationActions = new Set(['lock', 'unlock', 'mode', 'goal', 'reason', 'verify', 'deter', 'lights']);

    if (!isAdmin && action !== '' && action !== 'status' && action !== 'help' && action !== 'replay' && action !== 'bridge' && action !== 'goal' && action !== 'reason' && action !== 'verify' && action !== 'deter') {
      await message.reply({ content: 'Only admins can run that command.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    if (mode === MODES.LOCKDOWN && moderationActions.has(action) && !isLockdownAdmin) {
      await message.reply({ content: 'Lockdown mode: only lockdown admins can run that command.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    switch (action) {
      case '':
      case 'status':
        return handleStatusCommand(message, rest);
      case 'help':
        return message.reply(formatHelp());
      case 'replay':
        return handleReplayCommand(message, tokens.join(' '));
      case 'bridge':
        return handleBridgeCommand(message, tokens);
      case 'lights':
        return handleLightsCommand(message, tokens);
      case 'lock':
        return handleLockCommand(message, rest, true);
      case 'unlock':
        return handleLockCommand(message, rest, false);
      case 'mode':
        return handleModeCommand(message, tokens);
      case 'goal':
        return handleGoalCommand(message, tokens);
      case 'reason':
        return handleReasonCommand(message, tokens);
      case 'verify':
        return handleVerifyCommand(message, tokens);
      case 'deter':
        return handleDeterCommand(message, tokens);
      default:
        return message.reply(formatHelp());
    }
  }

  return { handleCommand };
}

module.exports = { createCommandHandlers };
