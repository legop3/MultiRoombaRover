// Neato Feature Command
// Purpose: Exposes Neato state and supported actions through the shared text command route.
// Scope: Delegates device availability, Home Assistant calls, and operational errors to neatoService.
const NAVIGATION_MODES = Object.freeze({
  normal: 'Normal',
  gentle: 'Gentle',
  deep: 'Deep',
  quick: 'Quick',
});

function rawValue(value) {
  // The command mirrors the Neato card's raw status contract. Only genuinely
  // absent values receive a placeholder; known BrainSlug strings are not
  // shortened, humanized, or interpreted by the command layer.
  if (value == null || value === '') return 'unknown';
  return String(value);
}

function describeState(state = {}) {
  const telemetry = state.telemetry || {};
  const connection = state.connected ? 'connected' : 'offline';
  // batteryPercent is the canonical neatoService field. The old command read a
  // nonexistent batteryLevel property, which made every status report unknown.
  const battery = Number.isFinite(telemetry.batteryPercent)
    ? `${telemetry.batteryPercent}%`
    : 'unknown';
  const voltage = Number.isFinite(telemetry.batteryVoltage)
    ? `${telemetry.batteryVoltage.toFixed(2)} V`
    : 'unknown';

  return [
    `Neato: ${connection}`,
    `Battery: ${battery}`,
    `Battery voltage: ${voltage}`,
    `Robot alert: ${rawValue(telemetry.robotAlert)}`,
    `Robot error: ${rawValue(telemetry.robotError)}`,
    `Robot state: ${rawValue(telemetry.robotState)}`,
    `UI state: ${rawValue(telemetry.uiState)}`,
  ].join('\n');
}

function createNeatoCommand({ neatoService, sanitizeMentions }) {
  return async function handleNeatoCommand(message, tokens = []) {
    const action = String(tokens.shift() || 'status').toLowerCase();
    if (action === 'status') {
      // Raw device strings still pass through the transport's mention sanitizer
      // so Home Assistant state cannot create an accidental Discord mention.
      return message.reply({ content: sanitizeMentions(describeState(neatoService.getState())) });
    }

    if (action === 'navigation') {
      const requestedMode = String(tokens.shift() || '').toLowerCase();
      const navigationMode = NAVIGATION_MODES[requestedMode];
      if (!navigationMode || tokens.length > 0) {
        return message.reply({ content: 'Invalid Neato navigation mode. Use `neato navigation normal`, `neato navigation gentle`, `neato navigation deep`, or `neato navigation quick`.' });
      }
      try {
        await neatoService.setNavigationMode(navigationMode);
        return message.reply({ content: `Neato navigation mode set to ${navigationMode}.` });
      } catch (err) {
        return message.reply({ content: sanitizeMentions(`Neato command failed: ${err.message}`) });
      }
    }

    const actions = {
      start: ['now cleaning', neatoService.startCleaning],
      home: ['returning home', neatoService.sendHome],
      sound: ['playing sound', neatoService.locateRobot],
      clear: ['clearing errors', neatoService.clearErrors],
    };
    const selected = actions[action];
    if (!selected) {
      return message.reply({ content: 'Invalid Neato command. Use `neato status`, `neato start`, `neato home`, `neato sound`, `neato clear`, or `neato navigation <normal|gentle|deep|quick>`.' });
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
