// Replay Engine Constants
// Purpose: Defines runtime constants and filesystem paths used by replay worker and build pipelines.
// Scope: Reads env-driven tuning values once and exposes immutable configuration values.
const path = require('path');
const { resolveDataDir } = require('../../helpers/dataPaths');

const FFMPEG_BIN = process.env.FFMPEG_BIN || 'ffmpeg';
const SEGMENT_ROOT = path.join(resolveDataDir(), 'replay-segments');
const SEGMENT_SECONDS = Math.max(1, Number.parseInt(process.env.REPLAY_SEGMENT_SECONDS || '1', 10));
const BUFFER_SECONDS = Math.max(20, Number.parseInt(process.env.REPLAY_BUFFER_SECONDS || '45', 10));
const CLEANUP_INTERVAL_MS = 10_000;
const BUILD_DURATION_MS = Math.max(5000, Number.parseInt(process.env.REPLAY_DURATION_MS || '20000', 10));
const BUILD_GUARD_MS = Math.max(200, Number.parseInt(process.env.REPLAY_GUARD_MS || '1200', 10));
const TARGET_FPS = Math.max(10, Number.parseInt(process.env.REPLAY_TARGET_FPS || '30', 10));
const MAX_WIDTH = Math.max(320, Number.parseInt(process.env.REPLAY_MAX_WIDTH || '1280', 10));
const MAX_HEIGHT = Math.max(180, Number.parseInt(process.env.REPLAY_MAX_HEIGHT || '720', 10));
const MAX_BYTES = Math.floor(Number.parseFloat(process.env.REPLAY_MAX_OUTPUT_MB || '9.5') * 1024 * 1024);
const SIDEBAR_WIDTH = 190;

module.exports = {
  FFMPEG_BIN,
  SEGMENT_ROOT,
  SEGMENT_SECONDS,
  BUFFER_SECONDS,
  CLEANUP_INTERVAL_MS,
  BUILD_DURATION_MS,
  BUILD_GUARD_MS,
  TARGET_FPS,
  MAX_WIDTH,
  MAX_HEIGHT,
  MAX_BYTES,
  SIDEBAR_WIDTH,
};
