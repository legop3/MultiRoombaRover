// Operator Command Service
// Purpose: Routes transport-neutral operator command requests to registered server handlers.
// Scope: Owns shared parsing, authorization, feature gating, help, and execution without importing Discord.js.
const { formatHelp } = require('./help');
const { createLockCommand } = require('./commands/lock');
const { createModeCommand } = require('./commands/mode');
const { createReasonCommand } = require('./commands/reason');
const { createGoalCommand } = require('./commands/goal');
const { createVerifyCommand } = require('./commands/verify');
const { createDeterCommand } = require('./commands/deter');
const { createPermissionsCommand } = require('./commands/permissions');
const { createLightsCommand } = require('./commands/lights');
const { createKickCommand } = require('./commands/kick');
const { createLiftCommand } = require('./commands/lift');
const { createNeatoCommand } = require('./commands/neato');
const { getCommandConfig } = require('./config');
const { buildCommandRegistry } = require('./registry');

/*
  Commands that enforce their own permissions inside their handler rather than at
  the dispatcher. `goal` and `reason` are readable by anyone but only writable by
  an admin; `verify` and `deter` reject non-lockdown-admins themselves so they can
  explain which role is missing. Listing them here preserves that behavior now
  that the general non-admin gate is driven by registry metadata.
*/
const SELF_GATED_ACTIONS = new Set(['', 'status', 'help', 'replay', 'bridge', 'goal', 'reason', 'verify', 'deter']);

function createCommandHandlers(deps) {
  const {
    getMode,
    MODES,
  } = deps;
  // The prefix belongs to the always-available command system so every
  // transport parses the same namespace instead of maintaining local defaults.
  const { prefix: commandPrefix, timeStatusCommand } = getCommandConfig(deps.config);
  // The legacy time command is a bare word rather than a prefixed command. It
  // therefore needs its own configurable value, and `null` intentionally
  // disables it so multiple bots do not all answer `ts` in the same channel.
  // Lowercase cached copies avoid re-normalizing every message and keep command
  // matching case-insensitive without changing the original configured text
  // that is shown in help output.
  const normalizedCommandPrefix = commandPrefix.toLowerCase();
  const normalizedTimeStatusCommand = timeStatusCommand.toLowerCase();
  const registry = buildCommandRegistry(commandPrefix, timeStatusCommand);

  // Status, time status, replay delivery, and transport extensions may have
  // different presentation needs. Adapters inject those focused handlers while
  // the core retains parsing, policy, and command discovery ownership.
  const transportHandlers = deps.transportHandlers || {};
  const handleStatusCommand = transportHandlers.status;
  const handleReplayCommand = deps.createReplayTextCommand
    ? deps.createReplayTextCommand(deps)
    : transportHandlers.replay;
  const handleLockCommand = createLockCommand(deps);
  const handleModeCommand = createModeCommand(deps);
  const handleReasonCommand = createReasonCommand(deps);
  const handleGoalCommand = createGoalCommand(deps);
  const handleVerifyCommand = createVerifyCommand(deps);
  const handleDeterCommand = createDeterCommand(deps);
  const handlePermissionsCommand = createPermissionsCommand(deps);
  const handleBridgeCommand = transportHandlers.bridge;
  const handleTimeStatusCommand = transportHandlers.timeStatus;
  const handleLightsCommand = createLightsCommand(deps);
  const handleKickCommand = createKickCommand(deps);
  const handleLiftCommand = createLiftCommand(deps);
  const handleNeatoCommand = createNeatoCommand(deps);

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

  async function handleCommand(request) {
    if (request.actor?.bot) return;
    const content = (request.content || '').trim();
    const lower = content.toLowerCase();
    // Commands are intentionally matched as whole prefixes. The previous
    // startsWith checks made ordinary messages such as "rsvp" or "tshirt" look
    // like commands, which is especially bad now that web chat will run the
    // same server-side dispatcher before broadcasting user text.
    if (normalizedTimeStatusCommand && lower === normalizedTimeStatusCommand) return handleTimeStatusCommand?.(request);

    const commandBody = stripCommandPrefix(content);
    if (commandBody === null) return;

    const tokens = commandBody ? commandBody.split(/\s+/) : [];
    const action = (tokens.shift() || '').toLowerCase();
    const rest = tokens.join(' ').trim();
    const isAdmin = Boolean(request.actor?.isAdmin);
    const isLockdownAdmin = Boolean(request.actor?.isLockdownAdmin);
    const mode = getMode();
    const commandDefinition = registry[action];
    if (commandDefinition?.requiredFeature && !deps.isFeatureEnabled(commandDefinition.requiredFeature)) {
      await request.reply({ content: `${commandDefinition.unavailableLabel || commandDefinition.requiredFeature} feature is not configured.` });
      return;
    }
    // Actions in this set can change operational safety or access policy, so
    // lockdown mode narrows them from normal admins to lockdown admins. Lights
    // is included because its lock/unlock subcommands change room policy. Its
    // ordinary on/off/color actions are also intentionally restricted to a
    // lockdown admin while the entire server is in lockdown.
    const moderationActions = new Set(['lock', 'unlock', 'mode', 'goal', 'reason', 'verify', 'deter', 'permissions', 'lights', 'kick', 'lift', 'neato']);
    const isAccessModeCommand = commandDefinition?.permission === 'access-mode';

    // Feature commands are public activities while access is open or managed
    // by turns. In admin mode they follow the same admin-only boundary as rover
    // access, and lockdown continues to require the stricter lockdown role.
    // Keeping this policy in the shared dispatcher makes web chat and Discord
    // behave identically instead of each transport interpreting modes itself.
    if (isAccessModeCommand && mode === MODES.ADMIN && !isAdmin) {
      await request.reply({ content: 'Admin mode: only admins can run feature commands.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    if (!isAccessModeCommand && !isAdmin && !SELF_GATED_ACTIONS.has(action)) {
      await request.reply({ content: 'Only admins can run that command.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    if (mode === MODES.LOCKDOWN && moderationActions.has(action) && !isLockdownAdmin) {
      await request.reply({ content: 'Lockdown mode: only lockdown admins can run that command.', allowedMentions: { parse: [], repliedUser: false } });
      return;
    }

    switch (action) {
      case '':
      case 'status':
        return handleStatusCommand?.(request, rest);
      case 'help':
        return request.reply(formatHelp({ commandPrefix, timeStatusCommand, topic: rest, includeDiscord: request.transport === 'discord', isFeatureEnabled: deps.isFeatureEnabled }));
      case 'replay':
        return handleReplayCommand?.(request, tokens.join(' '));
      case 'bridge':
        if (!handleBridgeCommand) return request.reply(formatHelp({ commandPrefix, timeStatusCommand, includeDiscord: false, isFeatureEnabled: deps.isFeatureEnabled }));
        return handleBridgeCommand(request, tokens);
      case 'lights':
        return handleLightsCommand(request, tokens);
      case 'kick':
        return handleKickCommand(request, rest);
      case 'lift':
        return handleLiftCommand(request, tokens);
      case 'neato':
        return handleNeatoCommand(request, tokens);
      case 'lock':
        return handleLockCommand(request, rest, true);
      case 'unlock':
        return handleLockCommand(request, rest, false);
      case 'mode':
        return handleModeCommand(request, tokens);
      case 'goal':
        return handleGoalCommand(request, tokens);
      case 'reason':
        return handleReasonCommand(request, tokens);
      case 'verify':
        return handleVerifyCommand(request, tokens);
      case 'deter':
        return handleDeterCommand(request, tokens);
      case 'permissions':
        return handlePermissionsCommand(request, tokens);
      default:
        return request.reply(formatHelp({ commandPrefix, timeStatusCommand, includeDiscord: request.transport === 'discord', isFeatureEnabled: deps.isFeatureEnabled }));
    }
  }

  return { handleCommand };
}

module.exports = { createCommandHandlers };
