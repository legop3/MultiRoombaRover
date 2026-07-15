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
  nonTurnVideo: 'snapshots',
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

function buildBandwidthSavingsPolicy(config = loadConfig()) {
  const raw = config.bandwidthSavings || {};
  return {
    multiTabProtection: normalizeEnum(
      raw.multiTabProtection,
      MULTI_TAB_MODES,
      DEFAULT_BANDWIDTH_SAVINGS.multiTabProtection,
    ),
    nonTurnVideo: normalizeEnum(
      raw.nonTurnVideo,
      VIDEO_MODES,
      DEFAULT_BANDWIDTH_SAVINGS.nonTurnVideo,
    ),
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

function shouldUseSnapshotsForNonTurnVideo() {
  return getBandwidthSavingsPolicy().nonTurnVideo === 'snapshots';
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
