// Replay Engine Constants
// Purpose: Defines runtime constants and filesystem paths used by replay worker and build pipelines.
// Scope: Reads env-driven tuning values once, and resolves the operator-configured replay length live from the admin configuration.
const path = require('path');
const { resolveDataDir } = require('../../helpers/dataPaths');
const { loadConfig } = require('../../configuration');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SEGMENT_ROOT = path.join(resolveDataDir(), 'replay-segments');
const SEGMENT_SECONDS = Math.max(1, Number.parseInt(process.env.REPLAY_SEGMENT_SECONDS || '1', 10));
// Floor for how much footage is retained; the effective buffer grows with the configured replay length.
const MIN_BUFFER_SECONDS = Math.max(20, Number.parseInt(process.env.REPLAY_BUFFER_SECONDS || '45', 10));
// Extra footage kept beyond the replay length so the guard window and indexing delay never starve a build.
const BUFFER_MARGIN_SECONDS = 25;
const DEFAULT_REPLAY_SECONDS = 45;
const MIN_REPLAY_SECONDS = 5;
const MAX_REPLAY_SECONDS = 120;
const CLEANUP_INTERVAL_MS = Math.max(500, Number.parseInt(process.env.REPLAY_TICK_MS || '2000', 10));
const BUILD_GUARD_MS = Math.max(200, Number.parseInt(process.env.REPLAY_GUARD_MS || '1200', 10));
const TARGET_FPS = Math.max(10, Number.parseInt(process.env.REPLAY_TARGET_FPS || '30', 10));
const MAX_WIDTH = Math.max(320, Number.parseInt(process.env.REPLAY_MAX_WIDTH || '1280', 10));
const MAX_HEIGHT = Math.max(180, Number.parseInt(process.env.REPLAY_MAX_HEIGHT || '720', 10));
const MAX_BYTES = Math.floor(Number.parseFloat(process.env.REPLAY_MAX_OUTPUT_MB || '9.5') * 1024 * 1024);
const SIDEBAR_WIDTH = 190;

/*
  Replay length is read from the live configuration on every use rather than
  captured at startup, so changing it in the admin panel applies to the next
  replay without a restart. Out-of-range or missing values fall back safely.
*/
function getBuildDurationMs() {
  const configured = Number(loadConfig().replay?.durationSeconds);
  const seconds = Number.isFinite(configured) ? Math.round(configured) : DEFAULT_REPLAY_SECONDS;
  return Math.min(MAX_REPLAY_SECONDS, Math.max(MIN_REPLAY_SECONDS, seconds)) * 1000;
}

function getBufferSeconds() {
  return Math.max(MIN_BUFFER_SECONDS, Math.ceil(getBuildDurationMs() / 1000) + BUFFER_MARGIN_SECONDS);
}

module.exports = {
  FFMPEG_BIN,
  SEGMENT_ROOT,
  SEGMENT_SECONDS,
  getBufferSeconds,
  CLEANUP_INTERVAL_MS,
  getBuildDurationMs,
  BUILD_GUARD_MS,
  TARGET_FPS,
  MAX_WIDTH,
  MAX_HEIGHT,
  MAX_BYTES,
  SIDEBAR_WIDTH,
};
