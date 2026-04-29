// Home Assistant Runtime Engine
// Purpose: Implements entity/trigger processing, light automation policy, and exposed control operations.
// Scope: Owns business logic while transport and event wiring are delegated to companion modules.
const { getMode } = require('../modeManager');
const { publishEvent } = require('../eventBus');
const {
  events,
  entityConfig,
  entityState,
  triggerConfig,
  triggerRuntime,
  HA_BUTTON_EVENT_TYPE,
  DEFAULT_WHITE_KELVIN,
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

  async function setEntityState(entityId, desiredState, options = {}) {
    if (!enabled) throw new Error('Home Assistant not configured');
    const meta = entityConfig.get(entityId);
    if (!meta) throw new Error('Unknown Home Assistant entity');
    if (!runtime.connection) throw new Error('Home Assistant not connected');

    const nextState = desiredState === 'on' ? 'on' : 'off';
    const domain = String(meta.domain || (meta.type === 'light' ? 'light' : 'switch')).toLowerCase();
    const service = nextState === 'on' ? 'turn_on' : 'turn_off';
    const source = String(options?.source || 'unknown');
    await callHomeAssistantService(domain, service, { entity_id: entityId });
    logger.info('Issued Home Assistant command', { entityId, domain, service, source });
  }

  async function setAllControllableEntitiesState(desiredState, options = {}) {
    const source = String(options?.source || 'unknown');
    const ids = getControllableEntityIds();
    if (!ids.length) return;
    logger.info('Issuing Home Assistant bulk state update', {
      desiredState: desiredState === 'on' ? 'on' : 'off',
      source,
      total: ids.length,
    });
    const results = await Promise.allSettled(
      ids.map((id) => setEntityState(id, desiredState, { source: `${source}:bulk` })),
    );
    const failures = results
      .map((result, index) => ({ result, entityId: ids[index] }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, entityId }) => ({ entityId, error: result.reason?.message || 'unknown error' }));
    const succeeded = results
      .map((result, index) => ({ result, entityId: ids[index] }))
      .filter(({ result }) => result.status === 'fulfilled')
      .map(({ entityId }) => entityId);
    if (failures.length) {
      logger.warn('Some Home Assistant entity state updates failed', {
        desiredState,
        total: ids.length,
        failed: failures.length,
        failures,
      });
    }
    return {
      desiredState: desiredState === 'on' ? 'on' : 'off',
      source,
      total: ids.length,
      succeeded,
      failures,
    };
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
      idleOffMs: null,
      idleOffAt: null,
      activeDrivers: null,
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
    // Idle automation moved to idleService; HA service only owns explicit room-control lock behavior.
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

  async function toggleEntity(entityId, options = {}) {
    const current = entityState.get(entityId);
    const nextState = current?.state === 'on' ? 'off' : 'on';
    const source = String(options?.source || 'homeAssistant:toggleEntity');
    return setEntityState(entityId, nextState, { source });
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
      if ((changed || forceApply) && enabled) {
        await setAllControllableEntitiesState(runtime.lightsLockState, {
          source: String(options?.source || 'homeAssistant:setLightsLockedOn'),
        });
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
    getControllableEntityIds,
    toggleEntity,
    setEntityState,
    setLightColor,
    setLightWhite,
    setAllControllableEntitiesState,
    setLightsLockedOn,
    toggleLightsLockedOn,
  };
}

module.exports = {
  createRuntimeEngine,
};
