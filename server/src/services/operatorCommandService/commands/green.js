// Operator Green Command
// Purpose: Toggles the intentionally silly server-wide green visual and room-light mode.
// Scope: Keeps command presentation here while Home Assistant owns the runtime policy.
const { getCommandConfig } = require('../../operatorCommandService/config');

function createGreenCommand({ greenModeService, sanitizeMentions, config }) {
  const { prefix: commandPrefix } = getCommandConfig(config);

  return async function handleGreenCommand(message, tokens = []) {
    const action = String(tokens.shift() || '').trim().toLowerCase();
    if (action !== 'on' && action !== 'off') {
      await message.reply({
        content: `Invalid green command. Use \`${commandPrefix} green on\` or \`${commandPrefix} green off\`.`,
        allowedMentions: { parse: [], repliedUser: false },
      });
      return;
    }

    try {
      const enabled = action === 'on';
      const result = await greenModeService.setEnabled(enabled, {
        source: `bot-command:green:${action}`,
      });
      await message.reply({
        content: sanitizeMentions(result ? 'Green mode enabled.' : 'Green mode disabled.'),
        allowedMentions: { parse: [], repliedUser: false },
      });
    } catch (err) {
      await message.reply({
        content: sanitizeMentions(`Failed to update green mode: ${err.message}`),
        allowedMentions: { parse: [], repliedUser: false },
      });
    }
  };
}

module.exports = { createGreenCommand };
