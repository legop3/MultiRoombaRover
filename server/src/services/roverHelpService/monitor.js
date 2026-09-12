// Rover Help Monitor
// Purpose: Converts sustained 600-series Roomba sensor conditions into one help state.
// Scope: Owns timing and reason state without performing roster fanout, alerts, or Discord I/O.
const WHEEL_DROP_HELP_MS = 15 * 60 * 1000;
const CLIFF_HELP_MS = 10 * 60 * 1000;
const DOCK_GUARD_HELP_MS = 15 * 60 * 1000;

const REASON_LABELS = Object.freeze({
  wheelDrop: 'a wheel-drop sensor remained active for 15 minutes',
  cliff: 'the same cliff-sensor pattern remained active for 10 minutes',
  docking: 'automatic docking remained active for 15 minutes',
});

function cliffPattern(sensors) {
  // A four-bit pattern distinguishes one continuously held physical situation
  // from a rover encountering different edges. Zero means no active cliff and
  // therefore cannot begin or retain a cliff-help timer.
  return [
    sensors?.cliffLeft,
    sensors?.cliffFrontLeft,
    sensors?.cliffFrontRight,
    sensors?.cliffRight,
  ].reduce((pattern, active, index) => pattern | (active ? 1 << index : 0), 0);
}

function createRoverHelpMonitor({ now = () => Date.now(), onChange = () => {} } = {}) {
  const states = new Map();

  function ensureState(roverId) {
    const id = String(roverId);
    if (!states.has(id)) {
      states.set(id, {
        wheelDropSince: null,
        cliffPattern: 0,
        cliffPatternSince: null,
        dockGuardSince: null,
        dockGuardSawPassive: false,
        reasons: new Set(),
      });
    }
    return states.get(id);
  }

  function updateReason(roverId, state, reason, active) {
    const hadReason = state.reasons.has(reason);
    if (active === hadReason) return;
    if (active) state.reasons.add(reason);
    else state.reasons.delete(reason);

    // Notify on every reason-set change so the integration can update the
    // aggregate flag correctly when one condition clears but another remains.
    onChange({
      roverId: String(roverId),
      needsHelp: state.reasons.size > 0,
      addedReason: active ? reason : null,
      removedReason: active ? null : reason,
      reasons: Array.from(state.reasons),
    });
  }

  function handleSensor(roverId, sensors) {
    if (!roverId || !sensors) return;
    const state = ensureState(roverId);
    const timestamp = now();
    const wheelDrop = Boolean(
      sensors?.bumpsAndWheelDrops?.wheelDropLeft || sensors?.bumpsAndWheelDrops?.wheelDropRight,
    );

    if (wheelDrop) {
      if (state.wheelDropSince == null) state.wheelDropSince = timestamp;
    } else {
      state.wheelDropSince = null;
    }
    updateReason(
      roverId,
      state,
      'wheelDrop',
      state.wheelDropSince != null && timestamp - state.wheelDropSince >= WHEEL_DROP_HELP_MS,
    );

    const nextCliffPattern = cliffPattern(sensors);
    if (!nextCliffPattern) {
      state.cliffPattern = 0;
      state.cliffPatternSince = null;
    } else if (nextCliffPattern !== state.cliffPattern) {
      // Any changed combination is new evidence on a non-mapping Roomba, not
      // proof that its chassis translated. Restart only the persistence timer;
      // encoder counts are deliberately not consulted anywhere in this monitor.
      state.cliffPattern = nextCliffPattern;
      state.cliffPatternSince = timestamp;
    }
    updateReason(
      roverId,
      state,
      'cliff',
      state.cliffPatternSince != null && timestamp - state.cliffPatternSince >= CLIFF_HELP_MS,
    );

    if (state.dockGuardSince != null) {
      const docked = Boolean(sensors?.chargingSources?.homeBase);
      const oiMode = sensors?.oiMode?.label || null;
      if (oiMode === 'passive') state.dockGuardSawPassive = true;
      if (docked || (state.dockGuardSawPassive && oiMode && oiMode !== 'passive')) {
        // Dock guard itself stops as soon as the 600-series wheels begin their
        // autonomous seek motion. Continue timing that seek after the guard
        // interval ends, and clear only on docking or a confirmed exit from the
        // passive OI mode used by opcode 143.
        state.dockGuardSince = null;
        state.dockGuardSawPassive = false;
      }
    }

    updateReason(
      roverId,
      state,
      'docking',
      state.dockGuardSince != null && timestamp - state.dockGuardSince >= DOCK_GUARD_HELP_MS,
    );
  }

  function handleDockGuard({ roverId, active, startedAt = null } = {}) {
    if (!roverId) return;
    const state = ensureState(roverId);
    if (active) {
      // Prefer roverManager's authoritative start time. The fallback keeps the
      // monitor deterministic if an event source omits it in a future caller.
      state.dockGuardSince = Number.isFinite(Number(startedAt)) ? Number(startedAt) : now();
      state.dockGuardSawPassive = false;
      return;
    }
    // Before passive mode is observed, a stopped guard means docking never
    // began. Once passive has been seen, wheel activity stops the guard even
    // though the Roomba is still autonomously seeking its dock, so sensor mode
    // and charging state become the authoritative completion signals instead.
    if (!state.dockGuardSawPassive) {
      state.dockGuardSince = null;
      updateReason(roverId, state, 'docking', false);
    }
  }

  function removeRover(roverId) {
    states.delete(String(roverId));
  }

  return {
    handleSensor,
    handleDockGuard,
    removeRover,
  };
}

module.exports = {
  CLIFF_HELP_MS,
  DOCK_GUARD_HELP_MS,
  REASON_LABELS,
  WHEEL_DROP_HELP_MS,
  cliffPattern,
  createRoverHelpMonitor,
};
