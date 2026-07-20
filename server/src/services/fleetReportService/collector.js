// Fleet Report Collector
// Purpose: Converts existing server events and high-rate rover sensor frames into bounded historical evidence.
// Scope: Performs passive normalization, battery-current integration, minute aggregation, and battery-session classification.
const crypto = require('crypto');

const MINUTE_MS = 60 * 1000;
const FULL_WAIT_MS = 5 * 60 * 1000;
const SESSION_KIND_CONFIRM_SAMPLES = 3;

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function minimum(previous, value) {
  if (value == null) return previous;
  return previous == null ? value : Math.min(previous, value);
}

function maximum(previous, value) {
  if (value == null) return previous;
  return previous == null ? value : Math.max(previous, value);
}

function eventRoverId(event) {
  const payload = event?.payload || {};
  // Generic payload `id` fields are commonly message, request, or job IDs and
  // must not be mistaken for rover identities. Producers use roverId (or an
  // explicit rover object) whenever the existing privacy resolver should scope
  // an event to a physical rover.
  return payload.roverId || payload.rover?.id || null;
}

function inferVisibility(event) {
  const payload = event?.payload || {};
  // Producers that know a stricter visibility scope may attach it explicitly.
  // Otherwise rover-scoped events are filtered later against the same visible
  // roster that drives the live UI, while verification/auth details retain the
  // existing lockdown-only boundary.
  if (payload.visibility) return String(payload.visibility);
  if (event?.source === 'verification' || event?.source === 'identity' || event?.source === 'auth') {
    return 'lockdown';
  }
  return eventRoverId(event) ? 'rover' : 'global';
}

function inferSeverity(type = '') {
  const value = String(type).toLowerCase();
  if (/fault|critical|urgent|failed|failure/.test(value)) return 'critical';
  if (/warn|offline|rejected|stopped|removed|denied/.test(value)) return 'warning';
  if (/started|completed|online|resolved|updated/.test(value)) return 'notice';
  return 'informational';
}

function batteryKey(roverId) {
  // Until an admin registers a physical battery, the stable fallback keeps all
  // observations attached to the rover without pretending the hardware has a
  // serial number exposed by OI.
  return `unregistered:${roverId}`;
}

function makeMinute(roverId, now) {
  return {
    roverId,
    bucketTs: Math.floor(now / MINUTE_MS) * MINUTE_MS,
    sampleCount: 0,
    coverageMs: 0,
    gapCount: 0,
    chargedMah: 0,
    dischargedMah: 0,
    minVoltageMv: null,
    maxVoltageMv: null,
    voltageTotal: 0,
    voltageCount: 0,
    minCurrentMa: null,
    maxCurrentMa: null,
    currentTotal: 0,
    currentCount: 0,
    minTemperatureC: null,
    maxTemperatureC: null,
    temperatureTotal: 0,
    temperatureCount: 0,
    minChargeMah: null,
    maxChargeMah: null,
    lastChargeMah: null,
    reportedCapacityMah: null,
    dockedSamples: 0,
    chargingSamples: 0,
    commandCount: 0,
    driveCommandCount: 0,
    rejectedCommandCount: 0,
    distanceMm: 0,
    bumpCount: 0,
    cliffCount: 0,
    wheelDropCount: 0,
    virtualWallCount: 0,
    overcurrentEpisodeCount: 0,
  };
}

function persistedMinute(minute) {
  return {
    roverId: minute.roverId,
    bucketTs: minute.bucketTs,
    sampleCount: minute.sampleCount,
    coverageMs: Math.round(minute.coverageMs),
    gapCount: minute.gapCount,
    chargedMah: minute.chargedMah,
    dischargedMah: minute.dischargedMah,
    minVoltageMv: minute.minVoltageMv,
    maxVoltageMv: minute.maxVoltageMv,
    avgVoltageMv: minute.voltageCount ? minute.voltageTotal / minute.voltageCount : null,
    minCurrentMa: minute.minCurrentMa,
    maxCurrentMa: minute.maxCurrentMa,
    avgCurrentMa: minute.currentCount ? minute.currentTotal / minute.currentCount : null,
    minTemperatureC: minute.minTemperatureC,
    maxTemperatureC: minute.maxTemperatureC,
    avgTemperatureC: minute.temperatureCount ? minute.temperatureTotal / minute.temperatureCount : null,
    minChargeMah: minute.minChargeMah,
    maxChargeMah: minute.maxChargeMah,
    lastChargeMah: minute.lastChargeMah,
    reportedCapacityMah: minute.reportedCapacityMah,
    dockedSamples: minute.dockedSamples,
    chargingSamples: minute.chargingSamples,
    commandCount: minute.commandCount,
    driveCommandCount: minute.driveCommandCount,
    rejectedCommandCount: minute.rejectedCommandCount,
    distanceMm: minute.distanceMm,
    bumpCount: minute.bumpCount,
    cliffCount: minute.cliffCount,
    wheelDropCount: minute.wheelDropCount,
    virtualWallCount: minute.virtualWallCount,
    overcurrentEpisodeCount: minute.overcurrentEpisodeCount,
  };
}

function newBatterySession(roverId, kind, now, sensors, state) {
  return {
    roverId,
    batteryKey: state.batteryKey || batteryKey(roverId),
    kind,
    startedAt: now,
    endedAt: null,
    startChargeMah: finite(sensors?.batteryChargeMah),
    endChargeMah: null,
    chargedMah: 0,
    dischargedMah: 0,
    minVoltageMv: finite(sensors?.voltageMv),
    maxVoltageMv: finite(sensors?.voltageMv),
    minTemperatureC: finite(sensors?.batteryTemperatureC),
    maxTemperatureC: finite(sensors?.batteryTemperatureC),
    sampleCount: 0,
    gapCount: 0,
    status: 'open',
    confidence: 'low',
    qualificationReason: 'session is still open',
    details: {
      startedFromQualifiedFull: Boolean(state.fullQualifiedAt),
      fullQualifiedAt: state.fullQualifiedAt,
      warnMah: finite(state.lastBatteryState?.warn),
      urgentMah: finite(state.lastBatteryState?.urgent),
      configuredFullMah: finite(state.lastBatteryState?.full),
    },
  };
}

function observedSessionKind(sensors) {
  const code = finite(sensors?.chargingState?.code);
  const docked = Boolean(sensors?.chargingSources?.homeBase || sensors?.chargingSources?.internalCharger);
  const current = finite(sensors?.currentMa);
  if (docked && (code === 1 || code === 2 || code === 3 || (current != null && current > 25))) return 'charging';
  if (!docked && current != null && current < -25) return 'discharging';
  return 'idle';
}

function createCollector({ storage, logger, maximumIntegrationGapMs, minimumCapacityTestDepthPercent }) {
  const roverStates = new Map();
  const lastManagerSampleAt = new Map();
  const diagnostics = {
    startedAt: Date.now(),
    eventsObserved: 0,
    eventsStored: 0,
    sensorFramesObserved: 0,
    validBatteryFrames: 0,
    integrationGaps: 0,
    minuteWrites: 0,
    sessionsCompleted: 0,
    lastEventAt: null,
    lastSensorAt: null,
    lastError: null,
  };

  function stateFor(roverId, now) {
    if (!roverStates.has(roverId)) {
      roverStates.set(roverId, {
        roverId,
        lastAt: null,
        minute: makeMinute(roverId, now),
        candidateKind: null,
        candidateCount: 0,
        sessionKind: 'idle',
        session: null,
        waitingSince: null,
        fullQualifiedAt: null,
        lastBatteryState: null,
        batteryKey: storage.getActiveBattery?.(roverId)?.batteryKey || batteryKey(roverId),
        lastOdometerTotalMm: null,
        safety: {
          bump: false,
          cliff: false,
          wheelDrop: false,
          virtualWall: false,
          overcurrent: false,
          overcurrentStartedAt: null,
          overcurrentSamples: 0,
        },
      });
    }
    return roverStates.get(roverId);
  }

  function collectEvent(event = {}) {
    diagnostics.eventsObserved += 1;
    diagnostics.lastEventAt = Date.now();
    try {
      const normalized = {
        ts: finite(event.ts) || Date.now(),
        source: String(event.source || 'unknown'),
        type: String(event.type || 'unknown'),
        roverId: eventRoverId(event),
        visibility: inferVisibility(event),
        severity: inferSeverity(event.type),
        correlationId: event?.payload?.correlationId || event?.payload?.jobId || event?.payload?.sessionId || null,
        payload: event.payload ?? null,
      };
      if (storage.insertEvent(normalized)) diagnostics.eventsStored += 1;
    } catch (err) {
      diagnostics.lastError = err.message;
      logger.warn('Fleet collector ignored malformed domain event', { error: err.message });
    }
  }

  function updateMinute(minute, sensors, elapsedMs, chargedMah, dischargedMah, gap) {
    const voltage = finite(sensors?.voltageMv);
    const current = finite(sensors?.currentMa);
    const temperature = finite(sensors?.batteryTemperatureC);
    const charge = finite(sensors?.batteryChargeMah);
    const capacity = finite(sensors?.batteryCapacityMah);
    minute.sampleCount += 1;
    minute.coverageMs += elapsedMs;
    minute.gapCount += gap ? 1 : 0;
    minute.chargedMah += chargedMah;
    minute.dischargedMah += dischargedMah;
    minute.minVoltageMv = minimum(minute.minVoltageMv, voltage);
    minute.maxVoltageMv = maximum(minute.maxVoltageMv, voltage);
    if (voltage != null) { minute.voltageTotal += voltage; minute.voltageCount += 1; }
    minute.minCurrentMa = minimum(minute.minCurrentMa, current);
    minute.maxCurrentMa = maximum(minute.maxCurrentMa, current);
    if (current != null) { minute.currentTotal += current; minute.currentCount += 1; }
    minute.minTemperatureC = minimum(minute.minTemperatureC, temperature);
    minute.maxTemperatureC = maximum(minute.maxTemperatureC, temperature);
    if (temperature != null) { minute.temperatureTotal += temperature; minute.temperatureCount += 1; }
    minute.minChargeMah = minimum(minute.minChargeMah, charge);
    minute.maxChargeMah = maximum(minute.maxChargeMah, charge);
    minute.lastChargeMah = charge;
    minute.reportedCapacityMah = capacity;
    if (sensors?.chargingSources?.homeBase) minute.dockedSamples += 1;
    if (observedSessionKind(sensors) === 'charging') minute.chargingSamples += 1;
  }

  function finishSession(state, now, sensors, reason) {
    const session = state.session;
    if (!session) return;
    session.endedAt = now;
    session.endChargeMah = finite(sensors?.batteryChargeMah);
    session.status = 'completed';

    if (session.kind === 'discharging') {
      const configuredFull = finite(session.details.configuredFullMah);
      const startCharge = finite(session.startChargeMah);
      const endCharge = finite(session.endChargeMah);
      const reference = configuredFull || startCharge;
      const observedDepth = reference && startCharge != null && endCharge != null
        ? Math.max(0, ((startCharge - endCharge) / reference) * 100)
        : 0;
      const reachedLowEndpoint = Boolean(
        state.lastBatteryState?.urgentActive ||
        (finite(session.details.urgentMah) != null && endCharge != null && endCharge <= session.details.urgentMah),
      );
      const qualified = Boolean(
        session.details.startedFromQualifiedFull &&
        reachedLowEndpoint &&
        observedDepth >= minimumCapacityTestDepthPercent &&
        session.gapCount === 0,
      );
      session.details.observedDepthPercent = observedDepth;
      session.details.reachedLowEndpoint = reachedLowEndpoint;
      session.details.capacityTestQualified = qualified;
      if (qualified) {
        session.confidence = 'high';
        session.qualificationReason = 'continuous qualified-full to low-endpoint discharge';
      } else if (observedDepth >= 30 && session.gapCount <= 1) {
        session.confidence = 'medium';
        session.qualificationReason = reason || 'useful partial discharge; not a full capacity test';
      } else {
        session.confidence = 'low';
        session.qualificationReason = reason || 'insufficient depth, endpoint, or telemetry coverage';
      }
    } else {
      session.confidence = session.gapCount === 0 ? 'high' : session.gapCount <= 1 ? 'medium' : 'low';
      session.qualificationReason = reason || 'charging session completed';
    }

    storage.insertBatterySession(session);
    diagnostics.sessionsCompleted += 1;
    state.session = null;
  }

  function applySessionKind(state, nextKind, now, sensors) {
    if (nextKind === state.sessionKind) {
      state.candidateKind = null;
      state.candidateCount = 0;
      return;
    }
    if (state.candidateKind !== nextKind) {
      state.candidateKind = nextKind;
      state.candidateCount = 1;
      return;
    }
    state.candidateCount += 1;
    if (state.candidateCount < SESSION_KIND_CONFIRM_SAMPLES) return;

    finishSession(state, now, sensors, `state changed from ${state.sessionKind} to ${nextKind}`);
    state.sessionKind = nextKind;
    state.candidateKind = null;
    state.candidateCount = 0;
    if (nextKind === 'charging' || nextKind === 'discharging') {
      state.session = newBatterySession(state.roverId, nextKind, now, sensors, state);
      // A qualified-full marker is consumed by the next discharge. Leaving it
      // set during the open session records the evidence in session details,
      // while clearing it prevents later partial sessions from inheriting it.
      if (nextKind === 'discharging') state.fullQualifiedAt = null;
    }
  }

  function updateFullQualification(state, now, sensors) {
    const waiting = finite(sensors?.chargingState?.code) === 4;
    if (waiting) {
      if (state.waitingSince == null) state.waitingSince = now;
      if (now - state.waitingSince >= FULL_WAIT_MS && state.fullQualifiedAt == null) {
        state.fullQualifiedAt = state.waitingSince + FULL_WAIT_MS;
      }
    } else {
      state.waitingSince = null;
    }
  }

  function collectSensor({ roverId, sensors, batteryState } = {}) {
    diagnostics.sensorFramesObserved += 1;
    diagnostics.lastSensorAt = Date.now();
    if (!roverId || !sensors || finite(sensors.currentMa) == null) return;
    diagnostics.validBatteryFrames += 1;
    const now = Date.now();
    const state = stateFor(String(roverId), now);
    state.lastBatteryState = batteryState || state.lastBatteryState;
    const elapsedMs = state.lastAt == null ? 0 : Math.max(0, now - state.lastAt);
    const gap = elapsedMs > maximumIntegrationGapMs;
    const validElapsedMs = gap ? 0 : elapsedMs;
    if (gap) diagnostics.integrationGaps += 1;
    const currentMa = finite(sensors.currentMa) || 0;
    const deltaMah = currentMa * validElapsedMs / 3600000;
    const chargedMah = Math.max(0, deltaMah);
    const dischargedMah = Math.max(0, -deltaMah);

    const bucketTs = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    if (state.minute.bucketTs !== bucketTs) {
      storage.upsertMinute(persistedMinute(state.minute));
      diagnostics.minuteWrites += 1;
      state.minute = makeMinute(state.roverId, now);
    }
    updateMinute(state.minute, sensors, validElapsedMs, chargedMah, dischargedMah, gap);
    const bumps = sensors?.bumpsAndWheelDrops || {};
    const nextSafety = {
      bump: Boolean(bumps.bumpLeft || bumps.bumpRight),
      cliff: Boolean(sensors.cliffLeft || sensors.cliffFrontLeft || sensors.cliffFrontRight || sensors.cliffRight),
      wheelDrop: Boolean(bumps.wheelDropLeft || bumps.wheelDropRight),
      virtualWall: Boolean(sensors.virtualWall),
      overcurrent: Boolean(
        sensors?.wheelOvercurrents?.leftWheel || sensors?.wheelOvercurrents?.rightWheel ||
        sensors?.wheelOvercurrents?.mainBrush || sensors?.wheelOvercurrents?.sideBrush,
      ),
    };
    if (nextSafety.bump && !state.safety.bump) state.minute.bumpCount += 1;
    if (nextSafety.cliff && !state.safety.cliff) state.minute.cliffCount += 1;
    if (nextSafety.wheelDrop && !state.safety.wheelDrop) state.minute.wheelDropCount += 1;
    if (nextSafety.virtualWall && !state.safety.virtualWall) state.minute.virtualWallCount += 1;
    if (nextSafety.overcurrent) state.safety.overcurrentSamples += 1;
    if (nextSafety.overcurrent && !state.safety.overcurrent) {
      state.minute.overcurrentEpisodeCount += 1;
      state.safety.overcurrentStartedAt = now;
      state.safety.overcurrentSamples = 1;
      collectEvent({
        source: 'fleetReportService',
        type: 'overcurrent.episode.started',
        ts: now,
        payload: { roverId: state.roverId, motors: sensors.wheelOvercurrents },
      });
    } else if (!nextSafety.overcurrent && state.safety.overcurrent) {
      collectEvent({
        source: 'fleetReportService',
        type: 'overcurrent.episode.resolved',
        ts: now,
        payload: {
          roverId: state.roverId,
          startedAt: state.safety.overcurrentStartedAt,
          durationMs: Math.max(0, now - (state.safety.overcurrentStartedAt || now)),
          sampleCount: state.safety.overcurrentSamples,
        },
      });
      state.safety.overcurrentStartedAt = null;
      state.safety.overcurrentSamples = 0;
    }
    Object.assign(state.safety, nextSafety);
    updateFullQualification(state, now, sensors);
    applySessionKind(state, observedSessionKind(sensors), now, sensors);

    if (state.session) {
      const session = state.session;
      session.sampleCount += 1;
      session.gapCount += gap ? 1 : 0;
      session.chargedMah += chargedMah;
      session.dischargedMah += dischargedMah;
      session.minVoltageMv = minimum(session.minVoltageMv, finite(sensors.voltageMv));
      session.maxVoltageMv = maximum(session.maxVoltageMv, finite(sensors.voltageMv));
      session.minTemperatureC = minimum(session.minTemperatureC, finite(sensors.batteryTemperatureC));
      session.maxTemperatureC = maximum(session.maxTemperatureC, finite(sensors.batteryTemperatureC));
    }
    state.lastAt = now;
  }

  function collectCommand(command = {}) {
    if (!command.roverId) return;
    const now = finite(command.ts) || Date.now();
    const state = stateFor(String(command.roverId), now);
    const bucketTs = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    if (state.minute.bucketTs !== bucketTs) {
      if (state.minute.sampleCount || state.minute.commandCount) {
        storage.upsertMinute(persistedMinute(state.minute));
        diagnostics.minuteWrites += 1;
      }
      state.minute = makeMinute(state.roverId, now);
    }
    state.minute.commandCount += 1;
    if (command.type === 'drive' || command.type === 'motors') state.minute.driveCommandCount += 1;
    if (command.outcome === 'rejected') state.minute.rejectedCommandCount += 1;

    // Drive/motor commands can arrive at control-loop frequency. Their exact
    // volume belongs in minute counters, while rejections and low-frequency
    // actions remain individually inspectable. This preserves operational
    // depth without turning normal held movement into an event-timeline flood.
    if ((command.type !== 'drive' && command.type !== 'motors') || command.outcome === 'rejected') {
      collectEvent({
        source: 'commandService',
        type: `command.${command.outcome || 'observed'}`,
        ts: now,
        payload: command,
      });
    }
  }

  function collectManagerEvent(kind, event = {}) {
    const roverId = event.roverId ? String(event.roverId) : null;
    if (kind === 'hostStats') {
      const key = `${kind}:${roverId || 'unknown'}`;
      const now = Date.now();
      // Host statistics arrive periodically and change gradually. One exact
      // sample every five minutes retains long-term diagnostic evidence while
      // avoiding a timeline row for every routine host heartbeat.
      if (now - (lastManagerSampleAt.get(key) || 0) < 5 * 60 * 1000) return;
      lastManagerSampleAt.set(key, now);
      collectEvent({
        source: 'roverHost',
        type: 'host.sample',
        ts: event.receivedAt || now,
        payload: { roverId, stats: event.stats || null },
      });
      return;
    }
    const payload = { ...event };
    // Live rover records contain websocket handles, sets, and other runtime
    // objects. The lifecycle facts are sufficient evidence and serialize
    // predictably without copying those control-owned objects into storage.
    delete payload.record;
    collectEvent({
      source: 'roverManager',
      type: `roverManager.${kind}`,
      payload,
    });
  }

  function collectOdometer({ roverId, odometer } = {}) {
    if (!roverId || !odometer) return;
    const now = finite(odometer.updatedAt) || Date.now();
    const state = stateFor(String(roverId), now);
    const totalMm = finite(odometer.totalMm);
    if (totalMm == null) return;
    const bucketTs = Math.floor(now / MINUTE_MS) * MINUTE_MS;
    if (state.minute.bucketTs !== bucketTs) {
      if (state.minute.sampleCount || state.minute.commandCount || state.minute.distanceMm) {
        storage.upsertMinute(persistedMinute(state.minute));
        diagnostics.minuteWrites += 1;
      }
      state.minute = makeMinute(state.roverId, now);
    }
    if (state.lastOdometerTotalMm != null && totalMm >= state.lastOdometerTotalMm) {
      // Odometer total is already rollover-corrected and sanity-filtered by its
      // owning service. Only non-negative increments belong in this report;
      // resets establish a new baseline instead of subtracting fleet distance.
      state.minute.distanceMm += totalMm - state.lastOdometerTotalMm;
    }
    state.lastOdometerTotalMm = totalMm;
  }

  function flushMinutes() {
    roverStates.forEach((state) => {
      if (!state.minute.sampleCount && !state.minute.commandCount && !state.minute.distanceMm) return;
      storage.upsertMinute(persistedMinute(state.minute));
      diagnostics.minuteWrites += 1;
    });
  }

  function getLiveState() {
    return Array.from(roverStates.values()).map((state) => ({
      roverId: state.roverId,
      lastAt: state.lastAt,
      sessionKind: state.sessionKind,
      waitingSince: state.waitingSince,
      fullQualifiedAt: state.fullQualifiedAt,
      minute: persistedMinute(state.minute),
      openSession: state.session ? {
        ...state.session,
        // The database serializer is not involved in this live response, so a
        // defensive copy prevents UI consumers from mutating collector state.
        details: { ...state.session.details },
      } : null,
    }));
  }

  function getDiagnostics() {
    return {
      ...diagnostics,
      activeRovers: roverStates.size,
      openSessions: Array.from(roverStates.values()).filter((state) => state.session).length,
      instanceId: crypto.createHash('sha1').update(String(diagnostics.startedAt)).digest('hex').slice(0, 10),
    };
  }

  function refreshBatteryIdentity(roverId) {
    const id = String(roverId || '');
    if (!id) return;
    const state = roverStates.get(id);
    if (!state) return;
    state.batteryKey = storage.getActiveBattery?.(id)?.batteryKey || batteryKey(id);
  }

  return {
    collectEvent,
    collectSensor,
    collectCommand,
    collectManagerEvent,
    collectOdometer,
    flushMinutes,
    getLiveState,
    getDiagnostics,
    refreshBatteryIdentity,
  };
}

module.exports = {
  createCollector,
};
