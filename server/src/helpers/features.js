// Feature Flags Helper
// Purpose: Normalizes optional server feature availability from config in one place.
// Scope: Keeps hardware/social visibility decisions out of individual UI panels and service callers.
const { loadConfig } = require('./configLoader');

function asBoolean(value, fallback = false) {
  /*
    Optional feature config is intentionally explicit. A missing `enabled` flag
    means "off" for specialty hardware, which makes a fresh public install a
    rover-only server until the operator opts into extra devices.
  */
  if (typeof value === 'boolean') return value;
  return fallback;
}

function asTrimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getRoomCameraEntries(config) {
  const raw = config.roomCameras;
  /*
    The public config uses `{ enabled, cameras }` so the feature gate is obvious.
    Accepting the old array shape here keeps the rest of the server from needing
    to know which shape the local config file currently uses.
  */
  if (Array.isArray(raw)) return raw;
  if (raw && typeof raw === 'object' && Array.isArray(raw.cameras)) return raw.cameras;
  return [];
}

function getConfiguredSocials(config) {
  /*
    Social links have an explicit feature switch. Entries under `links` are just
    available data; they do not enable the Links panel by existing.
  */
  const links = config.socials && typeof config.socials === 'object' ? config.socials.links : [];
  return Array.isArray(links)
    ? links.filter((entry) => asTrimmedString(entry?.url))
    : [];
}

function buildFeatureFlags(config = loadConfig()) {
  const homeAssistantConfig = config.homeAssistant || {};
  const roomCameraConfig = config.roomCameras || {};
  const kinectConfig = config.kinect || {};
  const buttonBoxConfig = config.buttonBox || {};
  const barcodeScannerConfig = config.barcodeScanner || {};
  const barcodeGamesConfig = config.barcodeGames || {};
  const socialsConfig = config.socials || {};
  const interInstanceConfig = config.interInstance || {};
  const homeAssistant = Boolean(
    asBoolean(homeAssistantConfig.enabled) &&
      asTrimmedString(homeAssistantConfig.url) &&
      asTrimmedString(homeAssistantConfig.token),
  );
  const roomCameraEntries = getRoomCameraEntries(config);
  const roomCamerasEnabled = Array.isArray(config.roomCameras)
    ? false
    : asBoolean(roomCameraConfig.enabled);
  const barcodeScanner = asBoolean(barcodeScannerConfig.enabled);

  return {
    homeAssistant,
    roomCameras: Boolean(roomCamerasEnabled && roomCameraEntries.length),
    kinect: asBoolean(kinectConfig.enabled),
    buttonBox: asBoolean(buttonBoxConfig.enabled),
    barcodeScanner,
    barcodeGames: Boolean(barcodeScanner && asBoolean(barcodeGamesConfig.enabled)),
    lift: Boolean(
      homeAssistant &&
        asBoolean(homeAssistantConfig.lift?.enabled) &&
        asTrimmedString(homeAssistantConfig.lift?.upSwitch) &&
        asTrimmedString(homeAssistantConfig.lift?.downSwitch),
    ),
    neato: Boolean(
      homeAssistant &&
        asBoolean(homeAssistantConfig.neato?.enabled) &&
        asTrimmedString(homeAssistantConfig.neato?.device),
    ),
    socials: Boolean(asBoolean(socialsConfig.enabled) && getConfiguredSocials(config).length > 0),
    interInstance: asBoolean(interInstanceConfig.enabled),
  };
}

function getFeatureFlags() {
  return buildFeatureFlags(loadConfig());
}

function isFeatureEnabled(featureName) {
  return Boolean(getFeatureFlags()[featureName]);
}

module.exports = {
  buildFeatureFlags,
  getFeatureFlags,
  isFeatureEnabled,
  getRoomCameraEntries,
  getConfiguredSocials,
};
