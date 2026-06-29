// button Box Service store
// Purpose: Owns persisted button-box state shape, normalization, and atomic file read/write operations.
// Scope: Keeps runtime behavior unchanged by isolating state persistence mechanics from reward/HTTP orchestration.
const fs = require('fs');

function createButtonBoxStore(deps) {
  const {
    logger,
    getRewardById,
    listRewards,
    dataDir,
    storePath,
    buttonCount,
    storeVersion,
  } = deps;

  let state = null;

  function createDefaultButton(id) {
    return {
      id,
      count: 0,
      rewardId: null,
      rewardName: null,
      rewardDescription: null,
      dailyLimited: false,
      rewardNumber: null,
      goal: null,
      dailyDate: null,
      dailyCount: 0,
      lastIncrementAt: null,
      lastRewardAt: null,
    };
  }

  function createDefaultState() {
    return {
      version: storeVersion,
      updatedAt: Date.now(),
      buttons: Array.from({ length: buttonCount }, (_, idx) => createDefaultButton(idx + 1)),
      effects: {},
    };
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function assignNewReward(button, options = {}) {
    const allRewards = listRewards();
    if (!allRewards.length) throw new Error('No rewards configured');
    const excludeRewardId = typeof options.excludeRewardId === 'string' ? options.excludeRewardId : null;

    const usedByOtherButtons = new Set(
      state.buttons
        .filter((entry) => entry.id !== button.id)
        .map((entry) => entry.rewardId)
        .filter((rewardId) => typeof rewardId === 'string' && rewardId.length > 0),
    );
    const uniqueCandidates = allRewards.filter(
      (reward) => !usedByOtherButtons.has(reward.id) && (!excludeRewardId || reward.id !== excludeRewardId),
    );
    const fallbackUniqueCandidates = allRewards.filter((reward) => !usedByOtherButtons.has(reward.id));
    const pool = uniqueCandidates.length
      ? uniqueCandidates
      : fallbackUniqueCandidates.length
        ? fallbackUniqueCandidates
        : allRewards.filter((reward) => !excludeRewardId || reward.id !== excludeRewardId);
    const reward = pool[Math.floor(Math.random() * pool.length)] || null;
    if (!reward) throw new Error('No rewards configured');

    button.rewardId = reward.id;
    button.rewardName = reward.name || null;
    button.rewardDescription = reward.description || null;
    button.dailyLimited = reward.dailyLimited === true;
    button.rewardNumber = reward.number;
    button.goal = reward.goal;
    button.count = 0;
    /*
      A new reward starts a fresh earning window for the button. Resetting the
      daily bucket here prevents leftover progress from the previous reward from
      making the newly assigned reward appear capped before anyone presses it.
    */
    button.dailyDate = null;
    button.dailyCount = 0;
  }

  function ensureRewardAssignments() {
    if (!state) return;
    const seen = new Set();
    state.buttons.forEach((button) => {
      const reward = getRewardById(button.rewardId);
      if (reward && !seen.has(reward.id)) {
        seen.add(reward.id);
        button.rewardName = reward.name || null;
        button.rewardDescription = reward.description || null;
        button.dailyLimited = reward.dailyLimited === true;
        button.rewardNumber = reward.number;
        button.goal = reward.goal;
        if (!Number.isFinite(button.count) || button.count < 0) {
          button.count = 0;
        }
        if (typeof button.dailyDate !== 'string' || !button.dailyDate) {
          button.dailyDate = null;
        }
        if (!Number.isFinite(button.dailyCount) || button.dailyCount < 0) {
          button.dailyCount = 0;
        }
        return;
      }
      assignNewReward(button);
      if (button.rewardId) {
        seen.add(button.rewardId);
      }
    });
  }

  function normalizeLoaded(raw = {}) {
    const base = createDefaultState();
    const sourceButtons = Array.isArray(raw.buttons) ? raw.buttons : [];
    const buttons = base.buttons.map((button, idx) => {
      const loaded = sourceButtons[idx] || {};
      return {
        ...button,
        count: Number.isFinite(loaded.count) ? Math.max(0, Math.floor(loaded.count)) : 0,
        rewardId: typeof loaded.rewardId === 'string' ? loaded.rewardId : null,
        rewardName: typeof loaded.rewardName === 'string' ? loaded.rewardName : null,
        rewardDescription: typeof loaded.rewardDescription === 'string' ? loaded.rewardDescription : null,
        dailyLimited: loaded.dailyLimited === true,
        rewardNumber: Number.isFinite(loaded.rewardNumber) ? Math.floor(loaded.rewardNumber) : null,
        goal: Number.isFinite(loaded.goal) ? Math.max(1, Math.floor(loaded.goal)) : null,
        dailyDate: typeof loaded.dailyDate === 'string' && loaded.dailyDate ? loaded.dailyDate : null,
        dailyCount: Number.isFinite(loaded.dailyCount) ? Math.max(0, Math.floor(loaded.dailyCount)) : 0,
        lastIncrementAt: Number.isFinite(loaded.lastIncrementAt) ? loaded.lastIncrementAt : null,
        lastRewardAt: Number.isFinite(loaded.lastRewardAt) ? loaded.lastRewardAt : null,
      };
    });

    const effects = raw.effects && typeof raw.effects === 'object' ? raw.effects : {};
    return {
      version: storeVersion,
      updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
      buttons,
      effects,
    };
  }

  function writeState() {
    fs.mkdirSync(dataDir, { recursive: true });
    const next = {
      ...state,
      updatedAt: Date.now(),
    };
    const tempPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    fs.renameSync(tempPath, storePath);
    state = next;
  }

  function loadState() {
    if (state) return state;
    try {
      const raw = JSON.parse(fs.readFileSync(storePath, 'utf8'));
      state = normalizeLoaded(raw);
    } catch (err) {
      if (err.code !== 'ENOENT') {
        logger.warn('Failed to load button box store', err.message);
      }
      state = createDefaultState();
    }
    ensureRewardAssignments();
    writeState();
    return state;
  }

  function getState() {
    loadState();
    return state;
  }

  function getDailyLimit(button) {
    /*
      The persisted file stores only the source values. The public snapshot adds
      this derived limit so clients can render daily status without duplicating
      button-box reward math in React components.
    */
    if (button?.dailyLimited !== true) {
      return null;
    }
    const goal = Number.isFinite(button?.goal) ? Math.max(1, Math.floor(button.goal)) : 1;
    return Math.max(1, Math.ceil(goal / 5));
  }

  function getStateClone() {
    const current = getState();
    return clone({
      buttons: current.buttons.map((button) => ({
        ...button,
        dailyLimit: getDailyLimit(button),
      })),
    });
  }

  return {
    loadState,
    writeState,
    getState,
    getStateClone,
    clone,
    assignNewReward,
  };
}

module.exports = {
  createButtonBoxStore,
};
