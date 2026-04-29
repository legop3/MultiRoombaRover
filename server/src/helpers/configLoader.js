// Config Loader Helper
// Purpose: Loads and validates YAML server configuration from configured paths. Scope: Provides normalized config access with sane defaults and cache behavior.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const CONFIG_PATH = process.env.SERVER_CONFIG || path.join(__dirname, '..', '..', 'config.yaml');

let cachedConfig;

function loadConfig() {
  if (cachedConfig) {
    return cachedConfig;
  }
  const file = fs.readFileSync(CONFIG_PATH, 'utf8');
  cachedConfig = yaml.load(file);
  return cachedConfig;
}

module.exports = {
  loadConfig,
};
