// First-Run Setup Service
// Purpose: Allows an empty data directory to create its first lockdown administrator or import an explicitly uploaded YAML file.
// Scope: Exposes setup-only socket operations and permanently closes them once a lockdown administrator exists.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('setupService');
const { getConfigurationDatabase } = require('../../configuration');
const { importConfigurationFile } = require('../../configuration/configurationFileImporter');
const { createSetupCodeFile } = require('./setupCodeFile');

const MAX_CONFIGURATION_FILE_BYTES = 1024 * 1024;
const database = getConfigurationDatabase();
const setupCodeFile = createSetupCodeFile();
let setupNoticeLogged = false;

function isSetupRequired() {
  return !database.isSetupComplete();
}

function ensureSetupCode() {
  if (!isSetupRequired()) {
    // Setup authorization permanently closes when the first lockdown account
    // exists. Remove a stale credential left by an interrupted final response.
    setupCodeFile.remove();
    return null;
  }
  const code = setupCodeFile.ensure();
  // Logs may be retained or shipped elsewhere, so they identify the local file
  // containing the credential without ever including the credential itself.
  if (!setupNoticeLogged) {
    logger.warn('First-run setup is required', { setupCodePath: setupCodeFile.filePath });
    setupNoticeLogged = true;
  }
  return code;
}

function requireOpenSetup(candidateCode) {
  if (!isSetupRequired()) throw new Error('First-run setup is already complete.');
  const expected = ensureSetupCode();
  const supplied = String(candidateCode || '').trim().toLowerCase();
  const matches = supplied.length === expected.length
    && crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(expected));
  if (!matches) throw new Error('Invalid setup code.');
}

function respond(cb, work) {
  Promise.resolve()
    .then(work)
    .then((result) => cb({ success: true, ...result }))
    .catch((error) => {
      logger.warn('First-run setup request failed', { error: error.message });
      cb({
        error: error.message,
        code: error.code || null,
        validationErrors: error.validationErrors || null,
      });
    });
}

ensureSetupCode();

io.on('connection', (socket) => {
  socket.on('setup:status', (_payload = {}, cb = () => {}) => {
    cb({ success: true, required: isSetupRequired() });
  });

  socket.on('setup:createAdministrator', (payload = {}, cb = () => {}) => {
    respond(cb, async () => {
      requireOpenSetup(payload.setupCode);
      const password = String(payload.password || '');
      if (password.length < 10) throw new Error('Administrator password must be at least 10 characters.');
      const passwordHash = await bcrypt.hash(password, 12);
      const administrator = database.createAdministrator({
        username: payload.username,
        passwordHash,
        discordId: payload.discordId,
        role: 'lockdown',
      }, 'first-run-setup');
      setupCodeFile.remove();
      return { administrator };
    });
  });

  socket.on('setup:importConfigurationFile', (payload = {}, cb = () => {}) => {
    respond(cb, () => {
      requireOpenSetup(payload.setupCode);
      const yamlText = String(payload.yaml || '');
      if (!yamlText || Buffer.byteLength(yamlText, 'utf8') > MAX_CONFIGURATION_FILE_BYTES) {
        throw new Error('The YAML configuration file must be present and no larger than 1 MiB.');
      }
      const result = importConfigurationFile({
        text: yamlText,
        database,
        actor: 'first-run-setup',
        source: String(payload.fileName || 'uploaded-config.yaml').slice(0, 255),
      });
      setupCodeFile.remove();
      return result;
    });
  });
});

module.exports = {
  isSetupRequired,
};
