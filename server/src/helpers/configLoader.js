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
