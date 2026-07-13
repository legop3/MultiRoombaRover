// Replay Engine V2
// Purpose: Composes replay segment capture, indexing, replay assembly, and health tick orchestration.
// Scope: Exposes replay build/health APIs while delegating implementation to focused submodules.
const { execFile } = require('child_process');
const { promisify } = require('util');
const fsp = require('fs/promises');
const logger = require('../../globals/logger').child('replayEngineV2');
const roverManager = require('../roverManager');
const { getRoomCameras, roomCameraEvents } = require('../roomCameraService');

const {
  SEGMENT_ROOT,
  SEGMENT_SECONDS,
  BUFFER_SECONDS,
  CLEANUP_INTERVAL_MS,
  BUILD_DURATION_MS,
} = require('./constants');
const { events, runtime } = require('./state');
const { createWorkerManager } = require('./workerManager');
const { createSegmentStore } = require('./segmentStore');
const { createSidebarRenderer } = require('./sidebarRenderer');
const { createReplayBuilder } = require('./replayBuilder');
const { tryTriggerReplay, getReplayState, replayEvents } = require('./cooldown');
const {
  getReplaySources,
  validateSources,
  getDefaultWebSources,
  getDefaultDiscordSources,
} = require('./replaySources');
const { registerReplaySocketHooks } = require('./socketHooks');

const execFileAsync = promisify(execFile);
runtime.activeSegmentRoot = SEGMENT_ROOT;

async function ensureDir(dir) {
  await fsp.mkdir(dir, { recursive: true });
}

function getActiveSegmentRoot() {
  return runtime.activeSegmentRoot;
}

const workerManager = createWorkerManager({ getActiveSegmentRoot });
const segmentStore = createSegmentStore({ getActiveSegmentRoot });
const sidebarRenderer = createSidebarRenderer({ execFileAsync, ensureDir });
const replayBuilder = createReplayBuilder({
  execFileAsync,
  fsp,
  ensureDir,
  renderSidebarVideo: sidebarRenderer.renderSidebarVideo,
  getVideoEntriesForSource: segmentStore.getVideoEntriesForSource,
  getAudioEntriesForSource: segmentStore.getAudioEntriesForSource,
  overlapping: segmentStore.overlapping,
});
registerReplaySocketHooks({ tryTriggerReplay, validateSources, getDefaultWebSources });

async function buildReplayVideoFresh(options = {}) {
  await tick();
  return replayBuilder.buildReplayVideo(options);
}

function getReplayHealthSnapshot() {
  return segmentStore.getReplayHealthSnapshot({ BUILD_DURATION_MS, roverManager, getRoomCameras });
}

async function tick() {
  if (runtime.tickInFlight) return;
  runtime.tickInFlight = true;
  try {
    await workerManager.syncWorkers();
    await segmentStore.refreshSegmentIndex();
    await segmentStore.cleanupOldFiles();
    events.emit('health', getReplayHealthSnapshot());
  } finally {
    runtime.tickInFlight = false;
  }
}

async function start() {
  await ensureDir(SEGMENT_ROOT);
  runtime.activeSegmentRoot = SEGMENT_ROOT;
  logger.info('Replay engine using segment root', { segmentRoot: runtime.activeSegmentRoot });
  await segmentStore.bootstrapIndexFromDisk();
  await tick();
  if (runtime.cleanupTimer) clearInterval(runtime.cleanupTimer);
  runtime.cleanupTimer = setInterval(() => {
    tick().catch((err) => logger.warn('tick failed', err.message));
  }, CLEANUP_INTERVAL_MS);
}

roomCameraEvents.on('update', () => {
  tick().catch((err) => logger.warn('room camera update tick failed', err.message));
});
roverManager.managerEvents.on('rover', () => {
  tick().catch((err) => logger.warn('rover update tick failed', err.message));
});
roverManager.managerEvents.on('private', () => {
  tick().catch((err) => logger.warn('private update tick failed', err.message));
});

start().catch((err) => {
  logger.warn('replay engine startup failed', err.message);
});

module.exports = {
  buildReplayVideo: buildReplayVideoFresh,
  tryTriggerReplay,
  getReplayState,
  replayEvents,
  getReplaySources,
  validateSources,
  getDefaultWebSources,
  getDefaultDiscordSources,
  getReplayHealthSnapshot,
  replayEngineEvents: events,
  replaySegmentRootDir: () => runtime.activeSegmentRoot,
  replaySegmentSeconds: SEGMENT_SECONDS,
  replayBufferSeconds: BUFFER_SECONDS,
};
