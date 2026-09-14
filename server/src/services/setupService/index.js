// First-Run Setup Service
// Purpose: Allows an empty data directory to create its first lockdown administrator or import legacy YAML safely.
// Scope: Exposes setup-only socket operations and permanently closes them once a lockdown administrator exists.
const crypto = require('crypto');
const bcrypt = require('bcrypt');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('setupService');
const { getConfigurationDatabase } = require('../../configuration');
const { importLegacyConfiguration } = require('../../configuration/legacyImporter');

const MAX_LEGACY_YAML_BYTES = 1024 * 1024;
const database = getConfigurationDatabase();
let setupCode = null;

function isSetupRequired() {
  return !database.isSetupComplete();
}

function ensureSetupCode() {
  if (!isSetupRequired()) return null;
  if (!setupCode) {
    setupCode = crypto.randomBytes(6).toString('hex');
    /*
      The code is intentionally logged only on a server that has no lockdown
      administrator. It lives in process memory, changes on restart, and is
      permanently irrelevant as soon as setup succeeds, so it cannot become a
      recurring environment-variable authentication bypass.
    */
    logger.warn('First-run setup is required', { setupCode });
  }
  return setupCode;
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
      setupCode = null;
      return { administrator };
    });
  });

  socket.on('setup:importLegacy', (payload = {}, cb = () => {}) => {
    respond(cb, () => {
      requireOpenSetup(payload.setupCode);
      const yamlText = String(payload.yaml || '');
      if (!yamlText || Buffer.byteLength(yamlText, 'utf8') > MAX_LEGACY_YAML_BYTES) {
        throw new Error('Legacy YAML must be present and no larger than 1 MiB.');
      }
      const result = importLegacyConfiguration({
        text: yamlText,
        database,
        actor: 'first-run-setup',
        source: String(payload.fileName || 'uploaded-config.yaml').slice(0, 255),
      });
      setupCode = null;
      return result;
    });
  });
});

module.exports = {
  isSetupRequired,
};
