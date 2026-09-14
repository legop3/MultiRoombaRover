// Complete Configuration Definition
// Purpose: Assembles service-owned configuration fragments into the one ordered document used by storage, validation, and the admin UI.
// Scope: Controls top-level order and composition only; each owning service defines the meaning, defaults, and schema of its own values.
const { strictObject } = require('./schemaHelpers');
const sessionConfiguration = require('../services/sessionService/configuration');
const interInstance = require('../services/interInstanceService/configuration');
const llmCommentary = require('../services/llmCommentaryService/configuration');
const overseerControl = require('../services/overseerControlService/configuration');
const barcodeGames = require('../services/barcodeGameService/configuration');
const media = require('../services/mediaMtxService/configuration');
const bandwidthSavings = require('../helpers/bandwidthSavings.configuration');
const audioForward = require('../services/audioForwardService/configuration');
const audioLevels = require('../services/audioLevelsService/configuration');
const homeAssistant = require('../services/homeAssistantService/configuration');
const roomCameras = require('../services/roomCameraService/configuration');
const ptzCamera = require('../services/ptzCameraService/configuration');
const kinect = require('../services/kinectService/configuration');
const balanceBoard = require('../services/balanceBoardService/configuration');
const buttonBox = require('../services/buttonBoxService/configuration');
const barcodeScanner = require('../services/barcodeScannerService/configuration');
const commands = require('../services/operatorCommandService/configuration');
const discord = require('../services/discordBotService/configuration');
const fleetReports = require('../services/fleetReportService/configuration');

/*
  Object property order is preserved by JSON serialization and JSON Schema
  consumers. Keeping this explicit list in legacy-YAML order makes the generic
  admin form predictable without creating a second frontend ordering system.
  The session service owns three non-adjacent public-presentation values, so
  those fragments are placed independently at their historical positions.
*/
const definitions = [
  sessionConfiguration.timezone,
  interInstance,
  llmCommentary,
  overseerControl,
  barcodeGames,
  media,
  bandwidthSavings,
  audioForward,
  audioLevels,
  homeAssistant,
  roomCameras,
  ptzCamera,
  kinect,
  balanceBoard,
  buttonBox,
  barcodeScanner,
  commands,
  discord,
  sessionConfiguration.socials,
  sessionConfiguration.driverAd,
  fleetReports,
];

const defaultConfig = Object.fromEntries(
  definitions.map(({ key, defaultValue }) => [key, defaultValue]),
);
const properties = Object.fromEntries(
  definitions.map(({ key, schema }) => [key, schema]),
);
const rootSchema = strictObject(properties, {
  title: 'Configuration',
  description: 'Complete server configuration. Changes are validated, saved as one revision, and applied live by reloading affected services.',
  required: definitions.map(({ key }) => key),
});

function collectFeatureDefinitions(definition, parentPath = []) {
  const configPath = [...parentPath, definition.key];
  const features = [];

  if (definition.feature === true) {
    /*
      A feature declaration is intentionally only a boolean marker. Its public
      name is the configuration item's key and its value is that item's own
      enabled field, so a service cannot introduce a second enablement rule in
      metadata. Failing during definition assembly catches an invalid marker at
      startup instead of publishing an undefined capability to browsers.
    */
    if (definition.schema?.properties?.enabled?.type !== 'boolean') {
      throw new Error(`Configuration feature ${definition.key} must define a boolean enabled field.`);
    }
    features.push({ key: definition.key, path: [...configPath, 'enabled'] });
  }

  const nestedDefinitions = Array.isArray(definition.nestedDefinitions)
    ? definition.nestedDefinitions
    : [];
  nestedDefinitions.forEach((nestedDefinition) => {
    features.push(...collectFeatureDefinitions(nestedDefinition, configPath));
  });
  return features;
}

/*
  This derived list replaces the old hand-maintained feature registry. Top-level
  and nested configuration owners opt in beside their schema, while this module
  only preserves their already-declared document paths.
*/
const featureDefinitions = definitions.flatMap((definition) => collectFeatureDefinitions(definition));

function collectWriteOnlyPaths(schema, prefix = '') {
  /*
    Secrets are declared once, beside the service field that consumes them.
    Walking object properties produces the dotted paths needed for redaction
    and update handling without maintaining a parallel secret registry.
  */
  if (!schema || typeof schema !== 'object') return [];
  if (schema.writeOnly === true) return prefix ? [prefix] : [];
  if (schema.type !== 'object' || !schema.properties) return [];
  return Object.entries(schema.properties).flatMap(([key, childSchema]) => (
    collectWriteOnlyPaths(childSchema, prefix ? `${prefix}.${key}` : key)
  ));
}

const secretPaths = collectWriteOnlyPaths(rootSchema);

module.exports = {
  definitions,
  defaultConfig,
  rootSchema,
  secretPaths,
  featureDefinitions,
};
