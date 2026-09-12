// Rover Help Horn Notifier
// Purpose: Repeats a short, disruptive locator chirp while a rover needs help.
// Scope: Uses the existing server-to-roverd horn start/stop protocol without changing roverd.
const HELP_HORN_FREQUENCY_HZ = 2000;
const HELP_HORN_DURATION_MS = 250;
const HELP_HORN_INTERVAL_MS = 5 * 1000;
const HELP_ROOMBA_NOTE = 83;
const HELP_ROOMBA_NOTE_DURATION = 16;

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

    // The Roomba song is self-terminating. With no pending external-horn stop,
    // there is no persistent sound owned by this notifier that needs cleanup.
    if (stopTimer == null) return;

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
    if (!record?.ws) return false;

    let sounded = false;
    let externalHornStarted = false;
    if (record.meta?.horn?.enabled) {
      try {
        issueCommand(id, {
          type: 'horn',
          horn: {
            action: 'start',
            waveform: 'saw',
            freqs: [HELP_HORN_FREQUENCY_HZ],
          },
        });
        sounded = true;
        externalHornStarted = true;
      } catch (err) {
        logger?.warn?.('Failed to start rover help horn', { roverId: id, error: err.message });
      }
    }

    try {
      // Roomba 600-series songs use MIDI notes and 1/64-second durations.
      // Note 83 is approximately 987.8 Hz: one octave below the closest MIDI
      // pitch to the external 2000 Hz horn. Duration 16 matches its 250 ms pulse.
      issueCommand(id, {
        type: 'song',
        song: {
          notes: [{ note: HELP_ROOMBA_NOTE, duration: HELP_ROOMBA_NOTE_DURATION }],
        },
      });
      sounded = true;
    } catch (err) {
      logger?.warn?.('Failed to play rover help song', { roverId: id, error: err.message });
    }

    if (externalHornStarted) {
      // There can be only one pending automatic stop for a rover. Replacing an
      // unexpected stale timer keeps the external pulse duration bounded; the
      // independently issued Roomba song always ends itself.
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
    }
    return sounded;
  }

  function start(roverId) {
    const id = String(roverId);
    if (intervals.has(id)) return;
    const record = getRover?.(id);
    if (!record?.ws) return;

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
  HELP_ROOMBA_NOTE,
  HELP_ROOMBA_NOTE_DURATION,
  createHelpHornNotifier,
};
