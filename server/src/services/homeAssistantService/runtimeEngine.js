// Home Assistant Runtime Engine
// Purpose: Implements entity/trigger processing, light automation policy, and exposed control operations.
// Scope: Owns business logic while transport and event wiring are delegated to companion modules.
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const { publishEvent } = require('../eventBus');
const { getMode } = require('../modeManager');
const { getActiveDrivers } = require('../turnService');
const {
  events,
  entityConfig,
  entityState,
  triggerConfig,
  triggerRuntime,
  HA_BUTTON_EVENT_TYPE,
  LIGHT_IDLE_OFF_MS,
  DEFAULT_WHITE_KELVIN,
  NIGHT_VISION_DISABLE_ACTION,
  runtime,
} = require('./state');
const { normalizeConfigEntry, normalizeTriggerEntry, buildState } = require('./entityHelpers');

function createRuntimeEngine(deps) {
  const { logger, enabled, haConfig, callHomeAssistantService } = deps;

  function emitUpdate(getState) {
    events.emit('update', getState());
  }

  function emitStatus(getState) {
    events.emit('status', getState());
  }

  function loadEntityConfig() {
    entityConfig.clear();
    const list = Array.isArray(haConfig?.entities) ? haConfig.entities : [];
    list.forEach((entry) => {
      const normalized = normalizeConfigEntry(entry);
      if (normalized) {
        entityConfig.set(normalized.id, normalized);
        if (!entityState.has(normalized.id)) {
          entityState.set(normalized.id, buildState(normalized, null));
        }
      }
    });
    logger.info('Loaded Home Assistant entities', { count: entityConfig.size });
  }

  function loadTriggerConfig() {
    triggerConfig.length = 0;
    const list = Array.isArray(haConfig?.buttons) ? haConfig.buttons : [];
    list.forEach((entry, index) => {
      const normalized = normalizeTriggerEntry(entry, index);
      if (!normalized) return;
      triggerConfig.push(normalized);
      if (!triggerRuntime.has(normalized.runtimeKey)) {
        triggerRuntime.set(normalized.runtimeKey, {
          lastFiredAt: 0,
          lastState: null,
          lastChanged: null,
          lastUpdated: null,
        });
      }
    });
    logger.info('Loaded Home Assistant buttons', { count: triggerConfig.length });
  }

  function getControllableEntityIds() {
    return Array.from(entityConfig.values()).map((meta) => String(meta.id));
  }

  function getActiveDriverCount() {
    const active = getActiveDrivers();
    const turnCount = active && typeof active === 'object' ? Object.keys(active).length : 0;
    if (turnCount > 0) return turnCount;
    let liveCount = 0;
    roverManager.rovers.forEach((record) => {
      if (record?.drivers?.size > 0) {
        liveCount += 1;
      }
    });
    return liveCount;
  }

  function hasActiveDrivers() {
    return getActiveDriverCount() > 0;
  }

  function turnOffAllRoverNightVision() {
    const records = Array.from(roverManager.rovers.values());
    let attempted = 0;
    let failed = 0;
    const roverIds = [];
    records.forEach((record) => {
      if (!record?.ws) return;
      roverIds.push(String(record.id));
      attempted += 1;
      try {
        issueCommand(record.id, {
          type: 'nightVision',
          nightVision: { action: NIGHT_VISION_DISABLE_ACTION },
        });
      } catch (err) {
        failed += 1;
        logger.warn('Failed to auto turn off rover night vision after idle', { roverId: record.id, error: err.message });
      }
    });
    return { attempted, failed, roverIds };
  }

  function clearLightsIdleOffTimer(getState) {
    if (runtime.lightsIdleOffTimer) {
      clearTimeout(runtime.lightsIdleOffTimer);
      runtime.lightsIdleOffTimer = null;
    }
    if (runtime.lightsIdleOffDeadline != null) {
      runtime.lightsIdleOffDeadline = null;
      emitUpdate(getState);
    }
  }

  async function setEntityState(entityId, desiredState) {
    if (!enabled) throw new Error('Home Assistant not configured');
    const meta = entityConfig.get(entityId);
    if (!meta) throw new Error('Unknown Home Assistant entity');
    if (!runtime.connection) throw new Error('Home Assistant not connected');

    const nextState = desiredState === 'on' ? 'on' : 'off';
    const domain = meta.type === 'light' ? 'light' : 'switch';
    const service = nextState === 'on' ? 'turn_on' : 'turn_off';
    await callHomeAssistantService(domain, service, { entity_id: entityId });
    logger.info('Issued Home Assistant command', { entityId, domain, service });
  }

  async function setAllControllableEntitiesState(desiredState) {
    const ids = getControllableEntityIds();
    if (!ids.length) return;
    const results = await Promise.allSettled(ids.map((id) => setEntityState(id, desiredState)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      logger.warn('Some Home Assistant entity state updates failed', {
        desiredState,
        total: ids.length,
        failed: failures.length,
      });
    }
  }

  function scheduleLightsIdleOffTimer(getState, evaluateLightAutomation) {
    if (!enabled) return;
    if (getControllableEntityIds().length === 0) return;
    if (runtime.lightsIdleOffTimer || runtime.lightsLockState != null || hasActiveDrivers()) {
      return;
    }
    runtime.lightsIdleOffDeadline = Date.now() + LIGHT_IDLE_OFF_MS;
    runtime.lightsIdleOffTimer = setTimeout(async () => {
      runtime.lightsIdleOffTimer = null;
      runtime.lightsIdleOffDeadline = null;
      try {
        await setAllControllableEntitiesState('off');
        const nightVisionResult = turnOffAllRoverNightVision();
        logger.info('Auto-turned off room lights due to no active drivers', {
          idleMs: LIGHT_IDLE_OFF_MS,
          nightVisionRovers: nightVisionResult.attempted,
          nightVisionFailures: nightVisionResult.failed,
          nightVisionRoverIds: nightVisionResult.roverIds,
        });
      } catch (err) {
        logger.warn('Failed auto light-off after idle', err.message);
      } finally {
        emitUpdate(getState);
        evaluateLightAutomation();
      }
    }, LIGHT_IDLE_OFF_MS);
    emitUpdate(getState);
  }

  function triggerMatches(trigger, raw, runtimeState) {
    if (!raw) return false;
    const nextState = raw?.state ?? null;
    const nextChanged = raw?.last_changed ?? null;
    const nextUpdated = raw?.last_updated ?? null;
    const changed =
      runtimeState.lastState !== nextState ||
      runtimeState.lastChanged !== nextChanged ||
      runtimeState.lastUpdated !== nextUpdated;
    if (!changed) {
      return { matched: false, nextState, nextChanged, nextUpdated };
    }
    if (trigger.stateEquals != null && String(trigger.stateEquals) !== String(nextState)) {
      return { matched: false, nextState, nextChanged, nextUpdated };
    }
    return { matched: true, nextState, nextChanged, nextUpdated };
  }

  function dispatchButtonAction(trigger, runtimeState, payload = {}) {
    const now = Date.now();
    const mode = String(getMode() || '').toLowerCase();
    if (trigger.allowedModes?.length && !trigger.allowedModes.includes(mode)) return;
    if (trigger.cooldownMs > 0 && now - runtimeState.lastFiredAt < trigger.cooldownMs) return;
    runtimeState.lastFiredAt = now;
    triggerRuntime.set(trigger.runtimeKey, runtimeState);
    const basePayload = {
      buttonId: trigger.action,
      action: trigger.action,
      firedAt: now,
      ...(payload || {}),
      ...(trigger.payload || {}),
    };
    logger.info('Home Assistant button action fired', {
      action: trigger.action,
      source: 'entity',
      entityId: payload?.entityId || null,
    });
    events.emit('trigger', basePayload);
    publishEvent({ source: 'homeAssistant', type: HA_BUTTON_EVENT_TYPE, payload: basePayload });
  }

  function evaluateTriggers(snapshot = {}) {
    if (!triggerConfig.length) return;
    triggerConfig.forEach((trigger) => {
      const runtimeState = triggerRuntime.get(trigger.runtimeKey) || {
        lastFiredAt: 0,
        lastState: null,
        lastChanged: null,
        lastUpdated: null,
      };
      const raw = snapshot?.[trigger.entityId] || null;
      const evalResult = triggerMatches(trigger, raw, runtimeState);
      runtimeState.lastState = evalResult.nextState;
      runtimeState.lastChanged = evalResult.nextChanged;
      runtimeState.lastUpdated = evalResult.nextUpdated;
      triggerRuntime.set(trigger.runtimeKey, runtimeState);
      if (!evalResult.matched) return;
      dispatchButtonAction(trigger, runtimeState, {
        entityId: trigger.entityId,
        state: raw?.state ?? null,
        attributes: raw?.attributes || {},
        lastChanged: raw?.last_changed || null,
        lastUpdated: raw?.last_updated || null,
      });
    });
  }

  function getLightPolicyState() {
    return {
      locked: runtime.lightsLockState != null,
      lockState: runtime.lightsLockState,
      lockedOn: runtime.lightsLockState === 'on',
      idleOffMs: LIGHT_IDLE_OFF_MS,
      idleOffAt: runtime.lightsIdleOffDeadline,
      activeDrivers: getActiveDriverCount(),
    };
  }

  function getState() {
    const entities = Array.from(entityConfig.values()).map((meta) => entityState.get(meta.id) || buildState(meta, null));
    return {
      enabled,
      connected: runtime.connected,
      entities,
      lightPolicy: getLightPolicyState(),
    };
  }

  function evaluateLightAutomation() {
    if (runtime.lightsLockState != null) {
      clearLightsIdleOffTimer(getState);
      return;
    }
    if (hasActiveDrivers()) {
      clearLightsIdleOffTimer(getState);
      return;
    }
    scheduleLightsIdleOffTimer(getState, evaluateLightAutomation);
  }

  function handleEntitySnapshot(snapshot = {}) {
    runtime.latestEntitySnapshot = snapshot || {};
    events.emit('snapshot', runtime.latestEntitySnapshot);
    let changed = false;
    entityConfig.forEach((meta, id) => {
      const raw = snapshot[id];
      const next = buildState(meta, raw);
      const prev = entityState.get(id);
      if (!prev || prev.state !== next.state || prev.available !== next.available || prev.lastChanged !== next.lastChanged) {
        entityState.set(id, next);
        changed = true;
      }
    });
    if (changed) emitUpdate(getState);
    evaluateTriggers(snapshot);
  }

  async function toggleEntity(entityId) {
    const current = entityState.get(entityId);
    const nextState = current?.state === 'on' ? 'off' : 'on';
    return setEntityState(entityId, nextState);
  }

  async function setLightColor(entityId, rgbColor) {
    if (!enabled) throw new Error('Home Assistant not configured');
    const meta = entityConfig.get(entityId);
    if (!meta || meta.type !== 'light') throw new Error('Home Assistant light required');
    if (!runtime.connection) throw new Error('Home Assistant not connected');
    if (!Array.isArray(rgbColor) || rgbColor.length !== 3) throw new Error('rgbColor required');

    const normalized = rgbColor.map((value) => {
      const next = Number(value);
      if (Number.isNaN(next)) return 0;
      return Math.max(0, Math.min(255, Math.round(next)));
    });
    await callHomeAssistantService('light', 'turn_on', { entity_id: entityId, rgb_color: normalized });
    logger.info('Issued Home Assistant color command', { entityId, rgbColor: normalized });
  }

  async function setLightWhite(entityId, kelvin = DEFAULT_WHITE_KELVIN) {
    if (!enabled) throw new Error('Home Assistant not configured');
    const meta = entityConfig.get(entityId);
    if (!meta || meta.type !== 'light') throw new Error('Home Assistant light required');
    if (!runtime.connection) throw new Error('Home Assistant not connected');

    const nextKelvin = Number(kelvin);
    const normalizedKelvin = Number.isFinite(nextKelvin)
      ? Math.max(2000, Math.min(6500, Math.round(nextKelvin)))
      : DEFAULT_WHITE_KELVIN;
    await callHomeAssistantService('light', 'turn_on', { entity_id: entityId, color_temp_kelvin: normalizedKelvin });
    logger.info('Issued Home Assistant white command', { entityId, colorTempKelvin: normalizedKelvin });
  }

  function isLightControlLocked() {
    return runtime.lightsLockState != null;
  }

  async function setLightsLockedOn(nextValue, options = {}) {
    const next = Boolean(nextValue);
    const targetState = options?.targetState === 'off' ? 'off' : 'on';
    const forceApply = Boolean(options.forceApply);
    const nextLockState = next ? targetState : null;
    const changed = runtime.lightsLockState !== nextLockState;
    runtime.lightsLockState = nextLockState;

    if (runtime.lightsLockState != null) {
      clearLightsIdleOffTimer(getState);
      if ((changed || forceApply) && enabled) {
        await setAllControllableEntitiesState(runtime.lightsLockState);
      }
    } else {
      evaluateLightAutomation();
    }

    if (changed) {
      logger.info('Room lights lock state changed', {
        locked: runtime.lightsLockState != null,
        lockState: runtime.lightsLockState,
        source: options.source || 'unknown',
      });
    }
    emitUpdate(getState);
    return runtime.lightsLockState === 'on';
  }

  async function toggleLightsLockedOn(options = {}) {
    return setLightsLockedOn(runtime.lightsLockState == null, options);
  }

  function getRawEntitySnapshot(entityId) {
    if (!entityId) return null;
    return runtime.latestEntitySnapshot?.[String(entityId)] || null;
  }

  return {
    loadEntityConfig,
    loadTriggerConfig,
    handleEntitySnapshot,
    evaluateLightAutomation,
    emitStatus,
    getState,
    getLightPolicyState,
    isLightControlLocked,
    getRawEntitySnapshot,
    toggleEntity,
    setEntityState,
    setLightColor,
    setLightWhite,
    setLightsLockedOn,
    toggleLightsLockedOn,
  };
}

module.exports = {
  createRuntimeEngine,
};
