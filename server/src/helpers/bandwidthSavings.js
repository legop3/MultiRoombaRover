// Bandwidth Savings Helper
// Purpose: Normalizes bandwidth-saving config and exposes tiny policy helpers.
// Scope: Keeps cross-service video/tab/spectator decisions consistent without
// making individual services know raw YAML defaults or legacy config shapes.
const { loadConfig } = require('./configLoader');

const MULTI_TAB_MODES = new Set(['allowed', 'verifiedOnly', 'notAllowed']);
const VIDEO_MODES = new Set(['snapshots', 'live']);
const EXTERNAL_SPECTATOR_ACCESS_MODES = new Set(['off', 'on', 'verifiedOnly', 'admin']);

const DEFAULT_BANDWIDTH_SAVINGS = Object.freeze({
  multiTabProtection: 'verifiedOnly',
  nonTurnVideo: Object.freeze({
    mode: 'snapshots',
    userThreshold: 0,
  }),
  externalSpectatorVideo: 'snapshots',
  externalSpectatorAccess: 'on',
});

function normalizeEnum(value, allowed, fallback) {
  /*
    Config files are hand-edited on the server, so a typo should not crash the
    process or silently broaden access. Each option falls back to the current
    conservative behavior unless it exactly matches a known value.
  */
  const normalized = typeof value === 'string' ? value.trim() : '';
  return allowed.has(normalized) ? normalized : fallback;
}

function normalizeNonTurnVideo(value) {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  const threshold = Number(raw.userThreshold);
  /*
    userThreshold is intentionally "greater than", not "greater than or equal".
    A value of 4 means the first four controllable users can keep live non-turn
    video, and the fifth controllable user activates snapshot saving. Invalid
    or negative values fall back to zero, which preserves always-on snapshots
    for any real non-turn participant.
  */
  const userThreshold = Number.isFinite(threshold) ? Math.max(0, Math.floor(threshold)) : 0;
  return {
    mode: normalizeEnum(raw.mode, VIDEO_MODES, DEFAULT_BANDWIDTH_SAVINGS.nonTurnVideo.mode),
    userThreshold,
  };
}

function buildBandwidthSavingsPolicy(config = loadConfig()) {
  const raw = config.bandwidthSavings || {};
  return {
    multiTabProtection: normalizeEnum(
      raw.multiTabProtection,
      MULTI_TAB_MODES,
      DEFAULT_BANDWIDTH_SAVINGS.multiTabProtection,
    ),
    nonTurnVideo: normalizeNonTurnVideo(raw.nonTurnVideo),
    externalSpectatorVideo: normalizeEnum(
      raw.externalSpectatorVideo,
      VIDEO_MODES,
      DEFAULT_BANDWIDTH_SAVINGS.externalSpectatorVideo,
    ),
    externalSpectatorAccess: normalizeEnum(
      raw.externalSpectatorAccess,
      EXTERNAL_SPECTATOR_ACCESS_MODES,
      DEFAULT_BANDWIDTH_SAVINGS.externalSpectatorAccess,
    ),
  };
}

function getBandwidthSavingsPolicy() {
  /*
    loadConfig() is cached by configLoader, so rebuilding this small object per
    caller is cheap while still letting tests pass explicit config objects into
    buildBandwidthSavingsPolicy().
  */
  return buildBandwidthSavingsPolicy(loadConfig());
}

function shouldEnforceSingleDriverTab({ isVerified = false, isAdmin = false } = {}) {
  const { multiTabProtection } = getBandwidthSavingsPolicy();
  if (multiTabProtection === 'allowed') return false;
  if (multiTabProtection === 'notAllowed') return true;
  /*
    verifiedOnly preserves the old behavior: trusted users can run multiple
    driver tabs for operations/testing, while anonymous users are limited to one
    active driver surface for fairness and bandwidth.
  */
  return !isVerified && !isAdmin;
}

function shouldUseSnapshotsForNonTurnVideo({ controllableUserCount = 0 } = {}) {
  const { nonTurnVideo } = getBandwidthSavingsPolicy();
  if (nonTurnVideo.mode !== 'snapshots') return false;
  /*
    The threshold is evaluated centrally so MediaMTX auth, socket-issued video
    tokens, PTZ authorization, and browser session state all agree. Using a
    strict greater-than comparison makes the configured value read like the
    maximum number of controllable users allowed before snapshots start.
  */
  return Math.max(0, Number(controllableUserCount) || 0) > nonTurnVideo.userThreshold;
}

function shouldUseSnapshotsForExternalSpectatorVideo() {
  return getBandwidthSavingsPolicy().externalSpectatorVideo === 'snapshots';
}

function canUseExternalSpectatorAccess({
  isLocal = false,
  isAdmin = false,
  isVerified = false,
  hasGrant = false,
} = {}) {
  /*
    Local/LAN spectators are not the upload-bandwidth problem, and admins need
    to retain access for maintenance. The configured external mode only applies
    to ordinary non-local spectator sockets.
  */
  if (isLocal || isAdmin) return true;
  const { externalSpectatorAccess } = getBandwidthSavingsPolicy();
  if (externalSpectatorAccess === 'off') return false;
  if (externalSpectatorAccess === 'verifiedOnly') return Boolean(isVerified);
  if (externalSpectatorAccess === 'admin') return Boolean(hasGrant);
  return true;
}

module.exports = {
  DEFAULT_BANDWIDTH_SAVINGS,
  buildBandwidthSavingsPolicy,
  getBandwidthSavingsPolicy,
  shouldEnforceSingleDriverTab,
  shouldUseSnapshotsForNonTurnVideo,
  shouldUseSnapshotsForExternalSpectatorVideo,
  canUseExternalSpectatorAccess,
};
