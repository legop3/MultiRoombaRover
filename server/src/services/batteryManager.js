const logger = require('../globals/logger').child('batteryManager');
const { publishEvent } = require('./eventBus');
const { managerEvents, lockRover, rovers } = require('./roverManager');

const STATES = {
  NORMAL: 'normal',
  WARN: 'warn',
  URGENT: 'urgent',
  DOCKED: 'docked',
  CHARGING: 'charging',
  FULL: 'full',
  LOCKED: 'locked',
};

const WAITING_UNLOCK_MS = 5 * 60 * 1000;

const roverState = new Map(); // roverId -> state snapshot

function getState(roverId) {
  if (!roverState.has(roverId)) {
    roverState.set(roverId, {
      lastPercent: null,
      warned: false,
      urgent: false,
      onDock: false,
      dockedCharging: false,
      charging: false,
      batteryLocked: false,
      waitingSince: null,
    });
  }
  return roverState.get(roverId);
}

function shouldLock(record) {
  return record.lockReason == null || record.lockReason === 'battery';
}

function handleSensorEvent({ roverId, sensors, batteryState }) {
  if (!roverId) return;
  const record = rovers.get(roverId);
  if (!record) return;
  const state = getState(roverId);
  const config = record.meta?.battery || {};
  const lockable = shouldLock(record);

  if (batteryState?.percent != null) {
    state.lastPercent = batteryState.percent;
  }

  if (!state.warned && batteryState?.warnActive) {
    state.warned = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.warn',
      payload: { roverId, batteryState },
    });
  }
  if (!state.urgent && batteryState?.urgentActive) {
    state.urgent = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.urgent',
      payload: { roverId, batteryState },
    });
  }

  const chargingState = sensors?.chargingState?.code;
  const chargingSources = sensors?.chargingSources;
  const onDock = Boolean(chargingSources?.homeBase);
  if (onDock && !state.onDock) {
    state.onDock = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.docked',
      payload: { roverId, batteryState },
    });
  } else if (!onDock && state.onDock) {
    state.onDock = false;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.undocked',
      payload: { roverId, batteryState },
    });
  }
  const chargingLabel = sensors?.chargingState?.label?.toLowerCase();
  const chargingByLabel =
    chargingLabel === 'waiting' || chargingLabel === 'full charging' || chargingLabel === 'trickle charging';
  const chargingByCode = chargingState === 2 || chargingState === 3 || chargingState === 4;
  const isCharging = chargingByLabel || chargingByCode;
  if (isCharging && !state.charging) {
    state.charging = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.charging.start',
      payload: { roverId, batteryState },
    });
  } else if (!isCharging && state.charging) {
    state.charging = false;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.charging.stop',
      payload: { roverId, batteryState },
    });
  }
  const dockedCharging = onDock && isCharging;
  if (dockedCharging && !state.dockedCharging) {
    state.dockedCharging = true;
  } else if (!dockedCharging && state.dockedCharging) {
    state.dockedCharging = false;
  }

  const waitingState = chargingState === 4;
  if (waitingState && state.waitingSince == null) {
    state.waitingSince = Date.now();
  } else if (!waitingState && state.waitingSince != null) {
    state.waitingSince = null;
  }
  const waitingLongEnough =
    waitingState && state.waitingSince != null && Date.now() - state.waitingSince >= WAITING_UNLOCK_MS;

  const warnThreshold =
    typeof config?.Warn === 'number' ? config.Warn : batteryState?.warn ?? null;
  const fullThreshold =
    typeof config?.Full === 'number' ? config.Full : batteryState?.full ?? null;
  const chargeMah = batteryState?.charge ?? null;
  let waitingPercent = batteryState?.percent ?? null;
  if (chargeMah != null && warnThreshold != null && fullThreshold != null && fullThreshold > warnThreshold) {
    waitingPercent = (chargeMah - warnThreshold) / (fullThreshold - warnThreshold);
    waitingPercent = Math.max(0, Math.min(1, waitingPercent));
  }

  const isFull =
    (batteryState?.charge != null && fullThreshold != null && batteryState.charge >= fullThreshold) ||
    (batteryState?.percent != null && batteryState.percent >= 0.99);

  const needsCharge = state.warned;

  if (dockedCharging && lockable && needsCharge && !state.batteryLocked && !isFull && !waitingLongEnough) {
    logger.info('Auto-locking rover for charging', { roverId });
    lockRover(roverId, true, { reason: 'battery' });
    state.batteryLocked = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.locked',
      payload: { roverId, batteryState },
    });
  }

  const waitingHalfOrMore = waitingPercent != null && waitingPercent >= 0.5;
  const shouldUnlock = state.batteryLocked && waitingLongEnough && waitingHalfOrMore;

  if (shouldUnlock) {
    logger.info('Unlocking rover after charge', {
      roverId,
      isFull,
      docked: dockedCharging,
      waitingState,
      waitingPercent,
      waitedMs: state.waitingSince ? Date.now() - state.waitingSince : null,
    });
    lockRover(roverId, false, { reason: 'battery' });
    state.batteryLocked = false;
    state.warned = false;
    state.urgent = false;
    state.waitingSince = null;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.unlocked',
      payload: { roverId, batteryState },
    });
  }
}

managerEvents.on('sensor', handleSensorEvent);
