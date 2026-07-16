// Lift Feature Command
// Purpose: Exposes lift state and movement through the shared text command route.
// Scope: Delegates interlocks, cooldowns, Home Assistant access, and runtime safety to liftService.
function describeState(state = {}) {
  const position = state.position || 'unknown';
  const connection = state.connected ? 'connected' : 'offline';
  const activity = state.busy ? `moving ${state.target || ''}`.trim() : 'idle';
  return `Lift: ${connection}; position ${position}; ${activity}.`;
}

function createLiftCommand({ liftService, sanitizeMentions }) {
  return async function handleLiftCommand(message, tokens = []) {
    const action = String(tokens.shift() || 'status').toLowerCase();
    if (action === 'status') return message.reply({ content: describeState(liftService.getState()) });

    try {
      if (action === 'up') await liftService.moveUp(`command:${message.actor?.id || 'unknown'}`);
      else if (action === 'down') await liftService.moveDown(`command:${message.actor?.id || 'unknown'}`);
      else return message.reply({ content: 'Invalid lift command. Use `lift status`, `lift up`, or `lift down`.' });
      return message.reply({ content: `Lift moving ${action}.` });
    } catch (err) {
      return message.reply({ content: sanitizeMentions(`Lift command failed: ${err.message}`) });
    }
  };
}

module.exports = { createLiftCommand };
