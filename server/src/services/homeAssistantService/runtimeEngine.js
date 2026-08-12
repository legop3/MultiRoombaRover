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

function arrayValuesEqual(left, right) {
  if (left === right) return true;
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  if (left.length !== right.length) return false;
  return left.every((value, index) => String(value) === String(right[index]));
}

function entityStateChanged(prev, next) {
  if (!prev) return true;

  // Home Assistant color changes often update attributes and last_updated
  // without changing the entity's on/off state or last_changed timestamp. The
  // web UI depends on those attribute updates for lamp tile colors, so the HA
  // runtime must treat them as real sync-worthy changes.
  return (
    prev.state !== next.state ||
    prev.available !== next.available ||
    prev.lastChanged !== next.lastChanged ||
    prev.lastUpdated !== next.lastUpdated ||
    prev.colorMode !== next.colorMode ||
    prev.colorHex !== next.colorHex ||
    prev.supportsColor !== next.supportsColor ||
    !arrayValuesEqual(prev.supportedColorModes, next.supportedColorModes) ||
    !arrayValuesEqual(prev.rgbColor, next.rgbColor) ||
    !arrayValuesEqual(prev.hsColor, next.hsColor)
  );
}

function hexToRgbColor(hex) {
  const raw = String(hex || '').trim();
  const normalized = raw.startsWith('#') ? raw.slice(1) : raw;
  if (!/^[0-9a-fA-F]{3}$|^[0-9a-fA-F]{6}$/.test(normalized)) return null;
  const expanded =
    normalized.length === 3
      ? normalized
          .split('')
          .map((char) => char + char)
          .join('')
      : normalized;
  return [
    Number.parseInt(expanded.slice(0, 2), 16),
    Number.parseInt(expanded.slice(2, 4), 16),
    Number.parseInt(expanded.slice(4, 6), 16),
  ];
}

function normalizeRgbColor(color) {
  const rawColor = typeof color === 'string' ? hexToRgbColor(color) : color;
  if (!Array.isArray(rawColor) || rawColor.length !== 3) {
    throw new Error('rgbColor hex string or [r,g,b] array required');
  }

  // The browser now sends hex because it is the simplest React/CSS format, but
  // accepting arrays keeps older clients and internal callers working. Home
  // Assistant still wants rgb_color, so the final conversion happens here.
  return rawColor.map((value) => {
    const next = Number(value);
    if (Number.isNaN(next)) return 0;
    return Math.max(0, Math.min(255, Math.round(next)));
  });
}

function createRuntimeEngine(deps) {
  const { logger, enabled, haConfig, callHomeAssistantService } = deps;

  async function turnOnLightAtFullBrightness(entityId, serviceData = {}) {
    /*
      Every server-owned interaction that turns on or changes a light must
      also restore it to full brightness. Home Assistant remembers a bulb's
      previous brightness, so sending only a color or color temperature can
      otherwise make a light appear unexpectedly dim even though this service
      requested an on-state.

      Keeping this rule in one helper makes it apply consistently to ordinary
      on commands, RGB changes, white-temperature changes, bulk operations,
      random scenes, and lock-on behavior. brightness_pct is deliberately
      written after the caller's service data so future call sites cannot
      accidentally override the service-wide 100 percent requirement.
    */
    await callHomeAssistantService('light', 'turn_on', {
      entity_id: entityId,
      ...serviceData,
      brightness_pct: 100,
    });
  }

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
    logger.info('Loaded Home Assistant entities', {
      count: entityConfig.size,
      entities: Array.from(entityConfig.values()).map((entry) => ({
        id: entry.id,
        type: entry.type,
        domain: entry.domain,
      })),
    });
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
    if (domain === 'light' && service === 'turn_on') {
      await turnOnLightAtFullBrightness(entityId);
    } else {
      // Off commands and non-light domains do not accept a meaningful light
      // brightness value, so their existing Home Assistant payload stays
      // intentionally unchanged.
      await callHomeAssistantService(domain, service, { entity_id: entityId });
    }
    logger.info('Issued Home Assistant command', { entityId, domain, service, source });
  }

  async function setAllControllableEntitiesState(desiredState, options = {}) {
    const source = String(options?.source || 'unknown');
    const ids = getControllableEntityIds();
    if (!ids.length) {
      logger.warn('Home Assistant bulk state update skipped; no controllable entities configured', {
        desiredState: desiredState === 'on' ? 'on' : 'off',
        source,
      });
      return {
        desiredState: desiredState === 'on' ? 'on' : 'off',
        source,
        total: 0,
        succeeded: [],
        failures: [],
      };
    }
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

  function createBrightRandomRgbColor() {
    // A completely random RGB triplet frequently produces colors that are very
    // dark, gray, or visually indistinguishable from a bulb being off. Choosing
    // a random hue at full saturation and brightness still gives every bulb a
    // genuinely random color while keeping the requested room effect vivid.
    const hueSegment = Math.random() * 6;
    const segmentIndex = Math.floor(hueSegment);
    const risingChannel = Math.round((hueSegment - segmentIndex) * 255);
    const fallingChannel = 255 - risingChannel;

    switch (segmentIndex) {
      case 0: return [255, risingChannel, 0];
      case 1: return [fallingChannel, 255, 0];
      case 2: return [0, 255, risingChannel];
      case 3: return [0, fallingChannel, 255];
      case 4: return [risingChannel, 0, 255];
      default: return [255, 0, fallingChannel];
    }
  }

  async function setRandomColorScene(options = {}) {
    const source = String(options?.source || 'homeAssistant:setRandomColorScene');
    const entities = Array.from(entityConfig.values()).map((meta) => ({
      meta,
      state: entityState.get(meta.id) || buildState(meta, null),
    }));

    // RGB capability comes from Home Assistant's live supported_color_modes
    // snapshot. This avoids a second operator-maintained list and makes newly
    // replaced bulbs automatically participate once Home Assistant reports
    // their capabilities. Everything else is turned off, including switches
    // and white-only lights, exactly matching the scene's requested boundary.
    const operations = entities.map(({ meta, state }) => {
      if (state.supportsColor) {
        return setLightColor(meta.id, createBrightRandomRgbColor());
      }
      return setEntityState(meta.id, 'off', { source: `${source}:non-rgb-off` });
    });
    const results = await Promise.allSettled(operations);
    const failures = results
      .map((result, index) => ({ result, entityId: entities[index].meta.id }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, entityId }) => ({ entityId, error: result.reason?.message || 'unknown error' }));
    const succeeded = results
      .map((result, index) => ({ result, entityId: entities[index].meta.id }))
      .filter(({ result }) => result.status === 'fulfilled')
      .map(({ entityId }) => entityId);

    if (failures.length) {
      logger.warn('Some Home Assistant random color scene updates failed', {
        total: entities.length,
        failed: failures.length,
        failures,
      });
    }

    return {
      source,
      total: entities.length,
      colorLights: entities.filter(({ state }) => state.supportsColor).length,
      nonColorEntities: entities.filter(({ state }) => !state.supportsColor).length,
      succeeded,
      failures,
    };
  }

  async function setEntityLockedOnWhite(entityId, options = {}) {
    const meta = entityConfig.get(entityId);
    const source = String(options?.source || 'homeAssistant:setEntityLockedOnWhite');

    // Lock-on is meant to make the real room visibly lit, so outlet-backed lamps
    // still only need a plain turn_on command. Home Assistant exposes those as
    // switch entities even though the user-facing object is a lamp.
    if (!meta || meta.type !== 'light') {
      return setEntityState(entityId, 'on', { source: `${source}:switch-on` });
    }

    try {
      // Color-capable lights should be forced to white during the lock so the
      // privacy/safety state is visually predictable instead of preserving the
      // previous red/blue/etc. color. The white command also turns the light on.
      await setLightWhite(entityId, haConfig?.whiteKelvin);
      return { entityId, mode: 'white' };
    } catch (err) {
      // Some Home Assistant light integrations report themselves as lights but
      // reject color temperature. Falling back to a plain turn_on preserves the
      // most important part of the lock behavior: every lamp is still on.
      logger.warn('Home Assistant lock white command failed; falling back to plain on', {
        entityId,
        error: err.message,
        source,
      });
      await setEntityState(entityId, 'on', { source: `${source}:white-fallback-on` });
      return { entityId, mode: 'fallback-on', whiteError: err.message };
    }
  }

  async function setAllControllableEntitiesLockedOnWhite(options = {}) {
    const source = String(options?.source || 'homeAssistant:setAllControllableEntitiesLockedOnWhite');
    const ids = getControllableEntityIds();
    if (!ids.length) {
      logger.warn('Home Assistant lock-on-white skipped; no controllable entities configured', {
        source,
      });
      return {
        desiredState: 'on',
        source,
        total: 0,
        succeeded: [],
        failures: [],
      };
    }

    logger.info('Issuing Home Assistant lock-on-white update', {
      source,
      total: ids.length,
    });

    // Each entity is settled independently because one flaky bulb should not
    // prevent the rest of the room from entering the locked-on state.
    const results = await Promise.allSettled(
      ids.map((id) => setEntityLockedOnWhite(id, { source: `${source}:bulk` })),
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
      logger.warn('Some Home Assistant lock-on-white updates failed', {
        total: ids.length,
        failed: failures.length,
        failures,
      });
    }

    return {
      desiredState: 'on',
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
      runtimeState.lastChanged !== nextChanged;
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
      if (entityStateChanged(prev, next)) {
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

  async function setLightColor(entityId, color) {
    if (!enabled) throw new Error('Home Assistant not configured');
    const meta = entityConfig.get(entityId);
    if (!meta || meta.type !== 'light') throw new Error('Home Assistant light required');
    if (!runtime.connection) throw new Error('Home Assistant not connected');

    const normalized = normalizeRgbColor(color);
    await turnOnLightAtFullBrightness(entityId, { rgb_color: normalized });
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
    await turnOnLightAtFullBrightness(entityId, { color_temp_kelvin: normalizedKelvin });
    logger.info('Issued Home Assistant white command', { entityId, colorTempKelvin: normalizedKelvin });
  }

  function isLightControlLocked() {
    return runtime.lightsLockState != null;
  }

  async function setLightsLockedOn(nextValue, options = {}) {
    const next = Boolean(nextValue);
    const targetState = options?.targetState === 'off' ? 'off' : 'on';
    const nextLockState = next ? targetState : null;
    const changed = runtime.lightsLockState !== nextLockState;
    runtime.lightsLockState = nextLockState;

    if (runtime.lightsLockState != null) {
      if (changed && enabled) {
        const source = String(options?.source || 'homeAssistant:setLightsLockedOn');
        /*
          A room-light lock is a policy boundary, not an ongoing reconciliation
          loop. Entering locked-on or locked-off sets every configured room
          control to the preferred state once so the room starts from the
          requested condition. After that first transition, the server leaves
          Home Assistant alone so out-of-band controls such as wall switches,
          Home Assistant dashboards, or vendor apps can still adjust individual
          lights without being periodically overwritten.

          Older callers may still pass forceApply from the previous behavior.
          It is intentionally ignored here because repeated lock requests must
          not become repeated light commands.
        */
        if (runtime.lightsLockState === 'on') {
          // The lock-on path is intentionally stronger than a normal bulk
          // turn_on. It makes actual light entities white while still turning
          // outlet-backed lamp switches on, matching the user's "light lock"
          // mental model for the room.
          await setAllControllableEntitiesLockedOnWhite({ source });
        } else {
          await setAllControllableEntitiesState(runtime.lightsLockState, {
            source,
          });
        }
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
    setRandomColorScene,
    setAllControllableEntitiesLockedOnWhite,
    setLightsLockedOn,
    toggleLightsLockedOn,
  };
}

module.exports = {
  createRuntimeEngine,
};
