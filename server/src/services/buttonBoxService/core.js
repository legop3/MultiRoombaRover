// button Box Service core
// Purpose: Handles reward execution, effect persistence/recovery, and press application workflows.
// Scope: Keeps runtime behavior unchanged while isolating domain logic from HTTP transport wiring.
function createButtonBoxCore(deps) {
  const {
    io,
    logger,
    getRewardById,
    roverManager,
    issueCommand,
    sendAlert,
    publishEvent,
    sendExternalTyping,
    sendExternalMessage,
    sendSystemMessage,
    getMode,
    setMode,
    getAdminReason,
    setAdminReason,
    clearAdminReason,
    assignmentService,
    getHomeAssistantState,
    setHomeAssistantEntityState,
    setHomeAssistantLightsLockedOn,
    store,
  } = deps;

  function publishUpdated() {
    publishEvent({
      source: 'buttonBox',
      type: 'buttonBox.updated',
      payload: { updatedAt: Date.now() },
    });
  }

  function saveEffect(effectId, payload = {}, options = {}) {
    const state = store.getState();
    state.effects = state.effects && typeof state.effects === 'object' ? state.effects : {};
    state.effects[effectId] = payload;
    store.writeState();
    if (options.broadcast) {
      publishUpdated();
    }
  }

  function clearEffect(effectId, options = {}) {
    const state = store.getState();
    if (state.effects && typeof state.effects === 'object' && state.effects[effectId]) {
      delete state.effects[effectId];
      store.writeState();
      if (options.broadcast) {
        publishUpdated();
      }
    }
  }

  function buildRewardContext() {
    return {
      logger,
      issueCommand,
      listOnlineRovers: () => roverManager.getRoster(),
      sendAlert,
      publishEvent,
      sendExternalTyping,
      sendExternalMessage,
      sendSystemMessage,
      getMode,
      setMode: (mode, source = 'buttonbox') =>
        setMode(
          mode,
          { data: { role: 'admin', user: { username: source } } },
          { force: true },
        ),
      getAdminReasonText: () => getAdminReason()?.text || null,
      setAdminReason: (text, source = 'buttonbox') => setAdminReason(text, { by: source }),
      clearAdminReason: (source = 'buttonbox') => clearAdminReason({ by: source }),
      rerollAssignments: () => assignmentService.rerollAssignments(),
      getHomeAssistantEntities: () => {
        const entities = getHomeAssistantState()?.entities;
        return Array.isArray(entities) ? entities : [];
      },
      getHomeAssistantLightPolicy: () => getHomeAssistantState()?.lightPolicy || null,
      setHomeAssistantEntityState: (entityId, state) =>
        setHomeAssistantEntityState(entityId, state, { source: 'buttonBoxReward' }),
      setHomeAssistantLightsLockedOn: (next, options = {}) =>
        setHomeAssistantLightsLockedOn(next, options),
      saveEffect: (effectId, payload = {}) => saveEffect(effectId, payload, { broadcast: false }),
      clearEffect: (effectId) => clearEffect(effectId, { broadcast: false }),
    };
  }

  async function runRewardForButton(button) {
    const reward = getRewardById(button.rewardId);
    if (!reward) {
      store.assignNewReward(button);
      return;
    }
    const completedCount = Number.isFinite(button.count) ? button.count : 0;
    const completedGoal = Number.isFinite(button.goal) ? button.goal : 0;
    const ctx = buildRewardContext();
    try {
      await reward.run(ctx);
    } catch (err) {
      logger.warn('Reward execution failed', { rewardId: reward.id, error: err.message });
    }
    io.emit('buttonBox:rewardRun', {
      buttonId: button.id,
      rewardId: reward.id,
      rewardName: reward.name || reward.id,
      count: completedCount,
      goal: completedGoal,
      ts: Date.now(),
    });
    button.lastRewardAt = Date.now();
    button.count = 0;
    store.assignNewReward(button, { excludeRewardId: reward.id });
  }

  async function applyPress(buttonId) {
    const state = store.getState();
    const button = state.buttons.find((entry) => entry.id === buttonId);
    if (!button) {
      throw new Error('Unknown button');
    }

    button.count += 1;
    button.lastIncrementAt = Date.now();
    store.writeState();

    io.emit('buttonBox:increment', {
      buttonId,
      count: button.count,
      ts: button.lastIncrementAt,
    });

    if (button.count >= button.goal) {
      await runRewardForButton(button);
      store.writeState();
    }

    publishUpdated();
    return store.clone(button);
  }

  async function addCount(buttonId, amount = 1) {
    const state = store.getState();
    const button = state.buttons.find((entry) => entry.id === buttonId);
    if (!button) {
      throw new Error('Unknown button');
    }
    const inc = Math.max(1, Math.floor(Number(amount) || 0));
    button.count += inc;
    button.lastIncrementAt = Date.now();
    store.writeState();

    io.emit('buttonBox:increment', {
      buttonId,
      count: button.count,
      ts: button.lastIncrementAt,
    });

    while (button.count >= button.goal) {
      await runRewardForButton(button);
      store.writeState();
    }

    publishUpdated();
    return store.clone(button);
  }

  async function recoverEffects() {
    const state = store.getState();
    const effects = state.effects && typeof state.effects === 'object' ? { ...state.effects } : {};
    const ctx = buildRewardContext();

    for (const [effectId, payload] of Object.entries(effects)) {
      const reward = getRewardById(effectId);
      if (!reward || typeof reward.recover !== 'function') {
        clearEffect(effectId, { broadcast: false });
        continue;
      }
      try {
        await reward.recover(ctx, payload);
      } catch (err) {
        logger.warn('Effect recovery failed', { effectId, error: err.message });
        clearEffect(effectId, { broadcast: false });
      }
    }
    publishUpdated();
  }

  return {
    applyPress,
    addCount,
    recoverEffects,
  };
}

module.exports = {
  createButtonBoxCore,
};
