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
    setGreenMode,
    isGreenModeEnabled,
    onGreenModeChange,
    store,
  } = deps;

  function getTodayKey(now = Date.now()) {
    /*
      The daily cap is intentionally based on the server's local calendar day.
      This matches the operational reality of the deployed server and avoids
      storing per-user timezone state for a physical shared button box.
    */
    const date = new Date(now);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function getDailyLimit(button) {
    /*
      Ceil lets a reward complete in five daily windows even when its goal is
      not evenly divisible by five. The minimum of one keeps tiny goals usable.
    */
    if (button?.dailyLimited !== true) {
      return null;
    }
    const goal = Number.isFinite(button?.goal) ? Math.max(1, Math.floor(button.goal)) : 1;
    return Math.max(1, Math.ceil(goal / 5));
  }

  function resetDailyBucketIfNeeded(button, now = Date.now()) {
    const today = getTodayKey(now);
    if (button.dailyDate !== today) {
      /*
        Date rollover is handled lazily on the next press/add-count request.
        That keeps the persisted state correct without needing a background
        timer that would sit around on the development machine.
      */
      button.dailyDate = today;
      button.dailyCount = 0;
    }
    if (!Number.isFinite(button.dailyCount) || button.dailyCount < 0) {
      button.dailyCount = 0;
    }
    return today;
  }

  function buildIncrementDescription({ appliedCount, limited }) {
    if (limited && appliedCount <= 0) {
      return 'Daily limit reached';
    }
    return 'Progress added';
  }

  function buildIncrementPayload({ button, requestedCount, appliedCount, limited, now }) {
    const dailyLimit = getDailyLimit(button);
    return {
      buttonId: button.id,
      count: button.count,
      goal: button.goal,
      dailyLimited: button.dailyLimited === true,
      limited,
      appliedCount,
      requestedCount,
      dailyCount: button.dailyCount,
      dailyLimit,
      description: buildIncrementDescription({ appliedCount, limited }),
      ts: now,
    };
  }

  function cloneButtonForResponse(button) {
    /*
      HTTP callers and overseer tools receive a direct button response instead
      of waiting for session sync. Include the derived daily limit there too so
      every public button shape describes the same daily-cap state.
    */
    return {
      ...store.clone(button),
      dailyLimit: getDailyLimit(button),
    };
  }

  async function applyProgress(buttonId, requestedCount = 1) {
    const state = store.getState();
    const button = state.buttons.find((entry) => entry.id === buttonId);
    if (!button) {
      throw new Error('Unknown button');
    }

    const now = Date.now();
    resetDailyBucketIfNeeded(button, now);

    const requested = Math.max(1, Math.floor(Number(requestedCount) || 0));
    const dailyLimited = button.dailyLimited === true;
    const dailyLimit = getDailyLimit(button);
    /*
      Most rewards are intentionally uncapped so button-box chaos can still be
      built up quickly. The daily bucket only constrains rewards that opt into
      it, currently the Discord pings that can bother people off-site.
    */
    const dailyRemaining = dailyLimited ? Math.max(0, dailyLimit - button.dailyCount) : requested;
    const appliedCount = dailyLimited ? Math.min(requested, dailyRemaining) : requested;
    const limited = dailyLimited && appliedCount < requested;

    if (appliedCount > 0) {
      button.count += appliedCount;
      if (dailyLimited) {
        button.dailyCount += appliedCount;
      }
      button.lastIncrementAt = now;
    }

    store.writeState();

    io.emit('buttonBox:increment', buildIncrementPayload({
      button,
      requestedCount: requested,
      appliedCount,
      limited,
      now,
    }));

    while (button.count >= button.goal) {
      await runRewardForButton(button);
      /*
        Reward assignment resets the daily bucket because the new reward should
        start clean instead of inheriting the just-completed reward's cap usage.
      */
      store.writeState();
    }

    publishUpdated();
    return cloneButtonForResponse(button);
  }

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
      // Rewards receive the standalone feature boundary rather than reaching
      // into Home Assistant or duplicating green-mode state and alerts.
      setGreenMode: (next, options = {}) => setGreenMode(next, options),
      isGreenModeEnabled: () => isGreenModeEnabled(),
      onGreenModeChange: (listener) => onGreenModeChange(listener),
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
    return applyProgress(buttonId, 1);
  }

  async function addCount(buttonId, amount = 1) {
    const inc = Math.max(1, Math.floor(Number(amount) || 0));
    return applyProgress(buttonId, inc);
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
