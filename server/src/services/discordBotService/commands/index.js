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
const { createKickCommand } = require('./kick');

function createCommandHandlers(deps) {
  const {
    getMode,
    MODES,
    isAdminUser,
    isLockdownAdminUser,
  } = deps;
  // Each running rover server can bring its own Discord bot into the same
  // guild, so the primary command prefix must come from config instead of
  // being hard-coded globally. The fallback preserves existing installs.
  const commandPrefix = String(deps.discordConfig?.commandPrefix || 'rs').trim() || 'rs';
  // The legacy time command is a bare word rather than a prefixed command. It
  // therefore needs its own configurable value, and `null` intentionally
  // disables it so multiple bots do not all answer `ts` in the same channel.
  const timeStatusCommand = deps.discordConfig?.timeStatusCommand === null
    ? ''
    : String(deps.discordConfig?.timeStatusCommand || 'ts').trim();
  // Lowercase cached copies avoid re-normalizing every message and keep command
  // matching case-insensitive without changing the original configured text
  // that is shown in help output.
  const normalizedCommandPrefix = commandPrefix.toLowerCase();
  const normalizedTimeStatusCommand = timeStatusCommand.toLowerCase();

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
  const handleKickCommand = createKickCommand(deps);

  function stripCommandPrefix(content) {
    const trimmed = String(content || '').trim();
    const lower = trimmed.toLowerCase();
    if (!lower.startsWith(normalizedCommandPrefix)) return null;

    const nextCharacter = trimmed.charAt(commandPrefix.length);
    // Prefixes are matched as whole command tokens so an instance using `rs`
    // still ignores ordinary words such as `rsvp`. This mirrors the old regex
    // behavior while letting each Discord bot instance use its own prefix.
    if (nextCharacter && !/\s/.test(nextCharacter)) return null;

    return trimmed.slice(commandPrefix.length).trim();
  }

  async function handleCommand(message) {
    if (message.author.bot) return;
    const content = (message.content || '').trim();
    const lower = content.toLowerCase();
    // Commands are intentionally matched as whole prefixes. The previous
    // startsWith checks made ordinary messages such as "rsvp" or "tshirt" look
    // like commands, which is especially bad now that web chat will run the
    // same server-side dispatcher before broadcasting user text.
    if (normalizedTimeStatusCommand && lower === normalizedTimeStatusCommand) return handleTimeStatusCommand(message);

    const commandBody = stripCommandPrefix(content);
    if (commandBody === null) return;

    const tokens = commandBody ? commandBody.split(/\s+/) : [];
    const action = (tokens.shift() || '').toLowerCase();
    const rest = tokens.join(' ').trim();
    const isAdmin = isAdminUser(message.author.id);
    const isLockdownAdmin = isLockdownAdminUser(message.author.id);
    const mode = getMode();
    // Actions in this set can change operational safety or access policy, so
    // lockdown mode narrows them from normal admins to lockdown admins. Room
    // light locking belongs here because it can force the physical room lights
    // on and disables ordinary Home Assistant room controls for everyone else.
    const moderationActions = new Set(['lock', 'unlock', 'mode', 'goal', 'reason', 'verify', 'deter', 'lights', 'kick']);

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
        return message.reply(formatHelp({ commandPrefix, timeStatusCommand }));
      case 'replay':
        return handleReplayCommand(message, tokens.join(' '));
      case 'bridge':
        return handleBridgeCommand(message, tokens);
      case 'lights':
        return handleLightsCommand(message, tokens);
      case 'kick':
        return handleKickCommand(message, rest);
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
        return message.reply(formatHelp({ commandPrefix, timeStatusCommand }));
    }
  }

  return { handleCommand };
}

module.exports = { createCommandHandlers };
