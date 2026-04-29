// button Box Service
// Purpose: Defines the button Box Service module and the helpers/state used by this service unit.
// Scope: Keeps runtime behavior unchanged while isolating responsibilities into a clear module boundary.
const fs = require('fs');
const express = require('express');
const { app } = require('../../globals/http');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('buttonBoxService');
const { resolveDataDir, resolveDataPath } = require('../../helpers/dataPaths');
const { publishEvent } = require('../eventBus');
const { getRewardById, listRewards } = require('../../rewards');
const roverManager = require('../roverManager');
const { issueCommand } = require('../commandService');
const { sendAlert } = require('../alertService');
const { sendExternalTyping, sendExternalMessage, sendSystemMessage } = require('../chatService');
const { setMode, getMode } = require('../modeManager');
const { getAdminReason, setAdminReason, clearAdminReason } = require('../adminReasonService');
const assignmentService = require('../assignmentService');
const {
  getState: getHomeAssistantState,
  setEntityState: setHomeAssistantEntityState,
  setLightsLockedOn: setHomeAssistantLightsLockedOn,
} = require('../homeAssistantService');
const { getRequestIp, isLocalNetwork, normalizeIp } = require('../../helpers/ipResolver');

const DATA_DIR = resolveDataDir();
const STORE_PATH = resolveDataPath('buttonbox-state.json');
const BUTTON_COUNT = 4;
const STORE_VERSION = 1;

let state = null;

function createDefaultButton(id) {
  return {
    id,
    count: 0,
    rewardId: null,
    rewardName: null,
    rewardNumber: null,
    goal: null,
    lastIncrementAt: null,
    lastRewardAt: null,
  };
}

function createDefaultState() {
  return {
    version: STORE_VERSION,
    updatedAt: Date.now(),
    buttons: Array.from({ length: BUTTON_COUNT }, (_, idx) => createDefaultButton(idx + 1)),
    effects: {},
  };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
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
      rewardNumber: Number.isFinite(loaded.rewardNumber) ? Math.floor(loaded.rewardNumber) : null,
      goal: Number.isFinite(loaded.goal) ? Math.max(1, Math.floor(loaded.goal)) : null,
      lastIncrementAt: Number.isFinite(loaded.lastIncrementAt) ? loaded.lastIncrementAt : null,
      lastRewardAt: Number.isFinite(loaded.lastRewardAt) ? loaded.lastRewardAt : null,
    };
  });

  const effects = raw.effects && typeof raw.effects === 'object' ? raw.effects : {};
  return {
    version: STORE_VERSION,
    updatedAt: Number.isFinite(raw.updatedAt) ? raw.updatedAt : Date.now(),
    buttons,
    effects,
  };
}

function writeState() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const next = {
    ...state,
    updatedAt: Date.now(),
  };
  const tempPath = `${STORE_PATH}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, 'utf8');
  fs.renameSync(tempPath, STORE_PATH);
  state = next;
}

function loadState() {
  if (state) return state;
  try {
    const raw = JSON.parse(fs.readFileSync(STORE_PATH, 'utf8'));
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

function ensureRewardAssignments() {
  if (!state) return;
  const seen = new Set();
  state.buttons.forEach((button) => {
    const reward = getRewardById(button.rewardId);
    if (reward && !seen.has(reward.id)) {
      seen.add(reward.id);
      button.rewardName = reward.name || null;
      button.rewardNumber = reward.number;
      button.goal = reward.goal;
      if (!Number.isFinite(button.count) || button.count < 0) {
        button.count = 0;
      }
      return;
    }
    assignNewReward(button);
    if (button.rewardId) {
      seen.add(button.rewardId);
    }
  });
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
  button.rewardNumber = reward.number;
  button.goal = reward.goal;
  button.count = 0;
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
    setHomeAssistantEntityState,
    setHomeAssistantLightsLockedOn: (next, options = {}) =>
      setHomeAssistantLightsLockedOn(next, options),
    saveEffect: (effectId, payload = {}) => saveEffect(effectId, payload, { broadcast: false }),
    clearEffect: (effectId) => clearEffect(effectId, { broadcast: false }),
  };
}

function getButtonBoxState() {
  loadState();
  return clone({ buttons: state.buttons });
}

function publishUpdated() {
  publishEvent({
    source: 'buttonBox',
    type: 'buttonBox.updated',
    payload: { updatedAt: Date.now() },
  });
}

function saveEffect(effectId, payload = {}, options = {}) {
  loadState();
  state.effects = state.effects && typeof state.effects === 'object' ? state.effects : {};
  state.effects[effectId] = payload;
  writeState();
  if (options.broadcast) {
    publishUpdated();
  }
}

function clearEffect(effectId, options = {}) {
  loadState();
  if (state.effects && typeof state.effects === 'object' && state.effects[effectId]) {
    delete state.effects[effectId];
    writeState();
    if (options.broadcast) {
      publishUpdated();
    }
  }
}

function parseButtonId(body) {
  if (typeof body !== 'string') return null;
  const value = Number.parseInt(body.trim(), 10);
  if (Number.isFinite(value)) return value;
  return null;
}

function denyIfNotLocal(req, res) {
  const ip = normalizeIp(getRequestIp(req));
  if (isLocalNetwork(ip)) {
    return false;
  }
  logger.warn('Rejected non-local button press request', { ip: ip || null });
  res.status(403).json({ error: 'Button presses must originate from local network' });
  return true;
}

async function runRewardForButton(button) {
  const reward = getRewardById(button.rewardId);
  if (!reward) {
    assignNewReward(button);
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
  assignNewReward(button, { excludeRewardId: reward.id });
}

async function applyPress(buttonId) {
  loadState();
  const button = state.buttons.find((entry) => entry.id === buttonId);
  if (!button) {
    throw new Error('Unknown button');
  }

  button.count += 1;
  button.lastIncrementAt = Date.now();
  writeState();

  io.emit('buttonBox:increment', {
    buttonId,
    count: button.count,
    ts: button.lastIncrementAt,
  });

  if (button.count >= button.goal) {
    await runRewardForButton(button);
    writeState();
  }

  publishUpdated();
  return clone(button);
}

async function recoverEffects() {
  loadState();
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

app.post('/buttonbox/press', express.text({ type: 'text/plain' }), async (req, res) => {
  if (denyIfNotLocal(req, res)) return;
  const buttonId = parseButtonId(req.body);
  if (!Number.isFinite(buttonId) || buttonId < 1 || buttonId > BUTTON_COUNT) {
    res.status(400).json({ error: 'button must be 1-4' });
    return;
  }
  try {
    const button = await applyPress(buttonId);
    res.json({ success: true, button });
  } catch (err) {
    res.status(500).json({ error: err.message || 'Button processing failed' });
  }
});

loadState();
recoverEffects().catch((err) => {
  logger.warn('Button box effect recovery failed', err.message);
});

module.exports = {
  getButtonBoxState,
};
