// Discord Lights Command
// Purpose: Handles admin room-light lock policy commands from Discord and web chat.
// Scope: Delegates all actual Home Assistant policy behavior to homeAssistantService.
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

function createLightsCommand({ homeAssistantService, sanitizeMentions }) {
  return async function handleLightsCommand(message, tokens = []) {
    // Defaulting to status makes `rs lights` safe to type while still exposing
    // the explicit mutating forms as `rs lights lock` and `rs lights unlock`.
    const action = String(tokens.shift() || 'status').trim().toLowerCase();

    if (!homeAssistantService) {
      await message.reply({
        content: 'Room light controls are unavailable.',
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

    if (action !== 'lock' && action !== 'unlock') {
      await message.reply({
        content: 'Invalid lights command. Use `rs lights lock`, `rs lights unlock`, or `rs lights status`.',
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    try {
      const locked = action === 'lock';
      // The bot command intentionally calls the shared policy setter instead of
      // issuing direct Home Assistant entity commands. That keeps all secondary
      // behavior centralized: web UI controls become disabled through the
      // session lightPolicy update, lock-on still forces configured lights to
      // white where possible, and commandService sees the same update event that
      // forces rover lasers off while the room is locked on.
      await homeAssistantService.setLightsLockedOn(locked, {
        source: `bot-command:lights:${action}`,
        forceApply: true,
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
