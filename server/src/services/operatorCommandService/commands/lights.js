// Operator Lights Command
// Purpose: Handles admin room-light lock policy commands from Discord and web chat.
// Scope: Delegates all actual Home Assistant policy behavior to homeAssistantService.
const { getCommandConfig } = require('../../operatorCommandService/config');

function describeLightPolicy(lightPolicy = {}) {
  // The HA service exposes both the newer explicit lockState and the older
  // lockedOn boolean. Prefer lockState because it can distinguish locked-on
  // from locked-off, but keep lockedOn as a defensive fallback for any caller
  // that passes an older or partial policy object.
  const lockState = lightPolicy?.lockState || (lightPolicy?.lockedOn ? 'on' : null);
  if (lockState === 'on') return 'Room lights are locked on.';
  if (lockState === 'off') return 'Room lights are locked off.';
  return 'Room lights are unlocked.';
}

function createLightsCommand({ homeAssistantService, sanitizeMentions, config }) {
  // The HA policy behavior is prefix-agnostic; this value is only used so
  // invalid-command guidance points admins at this bot instance's namespace.
  const { prefix: commandPrefix } = getCommandConfig(config);
  return async function handleLightsCommand(message, tokens = []) {
    // Defaulting to status makes the bare lights command safe to type while
    // still exposing explicit mutating forms under the configured prefix. This
    // matters when several bot instances share a Discord server and each one
    // needs its own command namespace.
    const action = String(tokens.shift() || 'status').trim().toLowerCase();

    if (!homeAssistantService) {
      await message.reply({
        content: 'Room light controls are unavailable.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    const isAdmin = Boolean(message.actor?.isAdmin);
    const adminActions = new Set(['status', 'lock', 'unlock']);

    // The lights namespace intentionally contains both public feature actions
    // and room-policy actions. The shared dispatcher applies the current server
    // mode to the feature as a whole; this focused check preserves the stronger
    // historical permission on status/lock/unlock without making on/off/colors
    // admin-only during normal open or turns operation.
    if (adminActions.has(action) && !isAdmin) {
      await message.reply({
        content: 'Only admins can manage the room-light lock.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    // An active lock is a policy boundary for ordinary feature commands. Admin
    // lock management remains available, but public scene commands must not
    // silently defeat a locked-on or locked-off room state.
    const lightPolicy = homeAssistantService.getLightPolicyState?.() || {};
    if ((action === 'on' || action === 'off' || action === 'colors') && lightPolicy.locked) {
      await message.reply({
        content: describeLightPolicy(lightPolicy),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (action === 'status') {
      await message.reply({
        content: describeLightPolicy(homeAssistantService.getLightPolicyState?.() || {}),
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    if (action === 'on' || action === 'off' || action === 'colors') {
      try {
        const result = action === 'colors'
          ? await homeAssistantService.setRandomColorScene({ source: 'bot-command:lights:colors' })
          : await homeAssistantService.setAllControllableEntitiesState(action, {
            source: `bot-command:lights:${action}`,
          });
        const failed = result?.failures?.length || 0;
        const succeeded = result?.succeeded?.length || 0;
        const description = action === 'colors'
          ? `Applied random colors to ${result?.colorLights || 0} RGB lights and requested off for ${result?.nonColorEntities || 0} non-RGB lights.`
          : `Turned ${action} ${succeeded} room lights.`;
        const failureSuffix = failed ? ` ${failed} failed.` : '';
        await message.reply({
          content: sanitizeMentions(`${description}${failureSuffix}`),
          allowedMentions: { parse: [], repliedUser: false },
        });
      } catch (err) {
        await message.reply({
          content: sanitizeMentions(`Failed to update room lights: ${err.message}`),
          allowedMentions: { parse: [], repliedUser: false },
        });
      }
      return;
    }

    if (action !== 'lock' && action !== 'unlock') {
      await message.reply({
        content: `Invalid lights command. Use \`${commandPrefix} lights on\`, \`${commandPrefix} lights off\`, \`${commandPrefix} lights colors\`, \`${commandPrefix} lights lock\`, \`${commandPrefix} lights unlock\`, or \`${commandPrefix} lights status\`.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    try {
      const locked = action === 'lock';
      // The bot command intentionally calls the shared policy setter instead of
      // issuing direct Home Assistant entity commands. That keeps all secondary
      // behavior centralized: web UI controls become disabled through the
      // session lightPolicy update, entering lock-on still sets configured
      // lights to white where possible once, and commandService sees the same
      // update event that forces rover lasers off while the room is locked on.
      await homeAssistantService.setLightsLockedOn(locked, {
        source: `bot-command:lights:${action}`,
      });

      await message.reply({
        content: sanitizeMentions(locked ? 'Room lights locked on.' : 'Room lights unlocked.'),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to update room lights: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
  };
}

module.exports = { createLightsCommand };
