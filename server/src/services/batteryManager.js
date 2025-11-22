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

const roverState = new Map(); // roverId -> state snapshot

function getState(roverId) {
  if (!roverState.has(roverId)) {
    roverState.set(roverId, {
      lastPercent: null,
      warned: false,
      urgent: false,
      dockedCharging: false,
      charging: false,
      batteryLocked: false,
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
  const isCharging = chargingState === 1 || chargingState === 2 || chargingState === 3;
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
    publishEvent({
      source: 'batteryManager',
      type: 'battery.docked',
      payload: { roverId, batteryState },
    });
  } else if (!dockedCharging && state.dockedCharging) {
    state.dockedCharging = false;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.undocked',
      payload: { roverId, batteryState },
    });
  }

  const fullThreshold =
    typeof config?.Full === 'number' ? config.Full : batteryState?.full ?? null;
  const isFull =
    (batteryState?.charge != null && fullThreshold != null && batteryState.charge >= fullThreshold) ||
    (batteryState?.percent != null && batteryState.percent >= 0.99);

  const needsCharge = state.warned;

  if (dockedCharging && lockable && needsCharge && !state.batteryLocked && !isFull) {
    logger.info('Auto-locking rover for charging', { roverId });
    lockRover(roverId, true, { reason: 'battery' });
    state.batteryLocked = true;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.locked',
      payload: { roverId, batteryState },
    });
  }

  const waitingState = chargingState === 4;
  const shouldUnlock = state.batteryLocked && (!dockedCharging || (isFull && waitingState));

  if (shouldUnlock) {
    logger.info('Unlocking rover after charge', {
      roverId,
      isFull,
      docked: dockedCharging,
      waitingState,
    });
    lockRover(roverId, false, { reason: 'battery' });
    state.batteryLocked = false;
    state.warned = false;
    state.urgent = false;
    publishEvent({
      source: 'batteryManager',
      type: 'battery.unlocked',
      payload: { roverId, batteryState },
    });
  }
}

managerEvents.on('sensor', handleSensorEvent);
