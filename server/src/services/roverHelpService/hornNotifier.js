// Rover Help Horn Notifier
// Purpose: Repeats a short, disruptive locator chirp while a rover needs help.
// Scope: Uses the existing server-to-roverd horn start/stop protocol without changing roverd.
const HELP_HORN_FREQUENCY_HZ = 2000;
const HELP_HORN_DURATION_MS = 250;
const HELP_HORN_INTERVAL_MS = 5 * 1000;

function createHelpHornNotifier({
  getRover,
  issueCommand,
  logger,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
} = {}) {
  const intervals = new Map();
  const stopTimers = new Map();

  function stopPendingHorn(roverId) {
    const id = String(roverId);
    const stopTimer = stopTimers.get(id);
    if (stopTimer != null) clearTimeoutFn(stopTimer);
    stopTimers.delete(id);

    // Always send a final stop during cleanup. This ensures HELP clearing in
    // the middle of a 250 ms chirp silences it immediately instead of waiting
    // for a timeout that was just cancelled.
    const record = getRover?.(id);
    if (!record?.ws) return;
    try {
      issueCommand(id, { type: 'horn', horn: { action: 'stop' } });
    } catch (err) {
      logger?.warn?.('Failed to stop rover help horn', { roverId: id, error: err.message });
    }
  }

  function chirp(roverId) {
    const id = String(roverId);
    const record = getRover?.(id);
    if (!record?.ws || !record?.meta?.horn?.enabled) return false;

    try {
      issueCommand(id, {
        type: 'horn',
        horn: {
          action: 'start',
          waveform: 'saw',
          freqs: [HELP_HORN_FREQUENCY_HZ],
        },
      });
    } catch (err) {
      logger?.warn?.('Failed to start rover help horn', { roverId: id, error: err.message });
      return false;
    }

    // There can be only one pending automatic stop for a rover. Replacing an
    // unexpected stale timer keeps the pulse duration bounded even if chirp is
    // called manually in addition to its normal five-second interval.
    const previousStop = stopTimers.get(id);
    if (previousStop != null) clearTimeoutFn(previousStop);
    stopTimers.set(
      id,
      setTimeoutFn(() => {
        stopTimers.delete(id);
        const current = getRover?.(id);
        if (!current?.ws) return;
        try {
          issueCommand(id, { type: 'horn', horn: { action: 'stop' } });
        } catch (err) {
          logger?.warn?.('Failed to finish rover help chirp', { roverId: id, error: err.message });
        }
      }, HELP_HORN_DURATION_MS),
    );
    return true;
  }

  function start(roverId) {
    const id = String(roverId);
    if (intervals.has(id)) return;
    const record = getRover?.(id);
    if (!record?.ws || !record?.meta?.horn?.enabled) return;

    // Sound immediately so a newly detected rover can be located without
    // waiting through the first five-second interval.
    chirp(id);
    intervals.set(id, setIntervalFn(() => chirp(id), HELP_HORN_INTERVAL_MS));
  }

  function stop(roverId) {
    const id = String(roverId);
    const interval = intervals.get(id);
    if (interval != null) clearIntervalFn(interval);
    intervals.delete(id);
    stopPendingHorn(id);
  }

  return {
    chirp,
    start,
    stop,
  };
}

module.exports = {
  HELP_HORN_DURATION_MS,
  HELP_HORN_FREQUENCY_HZ,
  HELP_HORN_INTERVAL_MS,
  createHelpHornNotifier,
};
