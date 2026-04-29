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

function createCommandHandlers(deps) {
  const {
    getMode,
    MODES,
    isAdminUser,
    isLockdownAdminUser,
  } = deps;

  const handleStatusCommand = createStatusCommand(deps);
  const handleReplayCommand = createReplayCommand(deps);
  const handleLockCommand = createLockCommand(deps);
  const handleModeCommand = createModeCommand(deps);
  const handleReasonCommand = createReasonCommand(deps);
  const handleGoalCommand = createGoalCommand(deps);
  const handleVerifyCommand = createVerifyCommand(deps);
  const handleDeterCommand = createDeterCommand(deps);
  const handleBridgeCommand = createBridgeCommand(deps);
  const handleTimeStatusCommand = createTimeStatusCommand(deps);

  async function handleCommand(message) {
    if (message.author.bot) return;
    const content = (message.content || '').trim();
    const lower = content.toLowerCase();
    if (lower === 'ts' || lower.startsWith('ts')) return handleTimeStatusCommand(message);
    if (!lower.startsWith('rs')) return;

    const tokens = content.split(/\s+/);
    tokens.shift();
    const action = (tokens.shift() || '').toLowerCase();
    const isAdmin = isAdminUser(message.author.id);
    const isLockdownAdmin = isLockdownAdminUser(message.author.id);
    const mode = getMode();
    const moderationActions = new Set(['lock', 'unlock', 'mode', 'goal', 'reason', 'verify', 'deter']);

    if (!isAdmin && action !== '' && action !== 'status' && action !== 'help' && action !== 'replay' && action !== 'bridge' && action !== 'goal' && action !== 'reason' && action !== 'verify' && action !== 'deter') {
      return;
    }

    if (mode === MODES.LOCKDOWN && moderationActions.has(action) && !isLockdownAdmin) {
      await message.reply({ content: 'Lockdown mode: only lockdown admins can run that command.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    switch (action) {
      case '':
      case 'status':
        return handleStatusCommand(message, tokens[0]);
      case 'help':
        return message.reply(formatHelp());
      case 'replay':
        return handleReplayCommand(message, tokens.join(' '));
      case 'bridge':
        return handleBridgeCommand(message, tokens);
      case 'lock':
        return handleLockCommand(message, tokens[0], true);
      case 'unlock':
        return handleLockCommand(message, tokens[0], false);
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
