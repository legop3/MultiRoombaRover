// Neato Feature Command
// Purpose: Exposes Neato state and supported actions through the shared text command route.
// Scope: Delegates device availability, Home Assistant calls, and operational errors to neatoService.
function describeState(state = {}) {
  const telemetry = state.telemetry || {};
  const connection = state.connected ? 'connected' : 'offline';
  return `Neato: ${connection}; state ${telemetry.robotState || 'unknown'}; battery ${telemetry.batteryLevel ?? 'unknown'}%.`;
}

function createNeatoCommand({ neatoService, sanitizeMentions }) {
  return async function handleNeatoCommand(message, tokens = []) {
    const action = String(tokens.shift() || 'status').toLowerCase();
    if (action === 'status') return message.reply({ content: describeState(neatoService.getState()) });

    const actions = {
      start: ['starting cleaning', neatoService.startCleaning],
      home: ['returning home', neatoService.sendHome],
      locate: ['playing locate sound', neatoService.locateRobot],
      'clear-errors': ['clearing errors', neatoService.clearErrors],
    };
    const selected = actions[action];
    if (!selected) {
      return message.reply({ content: 'Invalid Neato command. Use `neato status`, `neato start`, `neato home`, `neato locate`, or `neato clear-errors`.' });
    }

    try {
      await selected[1]();
      return message.reply({ content: `Neato is ${selected[0]}.` });
    } catch (err) {
      return message.reply({ content: sanitizeMentions(`Neato command failed: ${err.message}`) });
    }
  };
}

module.exports = { createNeatoCommand };
