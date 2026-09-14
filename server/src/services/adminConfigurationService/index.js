// Administrative Configuration Service
// Purpose: Exposes lockdown-only configuration, administrator, revision, and audit operations to the admin application.
// Scope: Owns socket authorization and password confirmation while delegating persistence invariants to the configuration database.
const bcrypt = require('bcrypt');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('adminConfigurationService');
const {
  getConfigurationDatabase,
  getRuntimeConfigurationRevision,
  getLastConfigurationApplication,
  applyCommittedConfiguration,
  rootSchema,
} = require('../../configuration');
const {
  MAX_CONFIGURATION_FILE_BYTES,
  parseConfigurationFile,
  buildSecretOperationsForImport,
} = require('../../configuration/configurationFileImporter');
const { getRole } = require('../roleService');

const PASSWORD_CONFIRMATION_WINDOW_MS = 5 * 60 * 1000;
const database = getConfigurationDatabase();

function requireLockdownAdministrator(socket) {
  if (getRole(socket) !== 'lockdown') throw new Error('Lockdown administrator required.');
}

function requireRecentPassword(socket) {
  requireLockdownAdministrator(socket);
  const confirmedAt = Number(socket?.data?.adminPasswordConfirmedAt) || 0;
  if (Date.now() - confirmedAt > PASSWORD_CONFIRMATION_WINDOW_MS) {
    const error = new Error('Confirm your password to continue.');
    error.code = 'PASSWORD_CONFIRMATION_REQUIRED';
    throw error;
  }
}

function actorFor(socket) {
  return socket?.data?.user?.username || socket.id;
}

function safeUploadedFileName(value) {
  /*
    The filename is audit metadata only and is never opened on the server.
    Removing control characters keeps logs and history readable while
    retaining the operator-visible name that identifies the imported file.
  */
  return String(value || 'uploaded-config.yaml')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, 255) || 'uploaded-config.yaml';
}

function errorPayload(error) {
  return {
    error: error.message,
    code: error.code || null,
    validationErrors: error.validationErrors || null,
    currentRevision: error.currentRevision || null,
  };
}

function ackHandler(socket, eventName, authorization, handler) {
  socket.on(eventName, (payload = {}, cb = () => {}) => {
    Promise.resolve()
      .then(() => authorization(socket))
      .then(() => handler(payload || {}))
      .then((result) => cb({ success: true, ...result }))
      .catch((error) => {
        logger.warn('Administrative configuration request failed', {
          eventName,
          socketId: socket.id,
          actor: actorFor(socket),
          error: error.message,
        });
        cb(errorPayload(error));
      });
  });
}

function buildAdminSnapshot() {
  const configuration = database.getClientConfiguration();
  return {
    /*
      The protected admin response carries the same schema used by server-side
      Ajv validation. It contains structure and help metadata but never stored
      values, allowing the browser to render configuration without maintaining
      a second field definition.
    */
    configuration: { ...configuration, schema: rootSchema },
    appliedRevision: getRuntimeConfigurationRevision(),
    configurationApplication: getLastConfigurationApplication(),
    administrators: database.listAdministrators(),
    revisions: database.listConfigurationRevisions(),
    auditEvents: database.listAuditEvents(),
  };
}

io.on('connection', (socket) => {
  ackHandler(socket, 'adminConfig:get', requireLockdownAdministrator, () => buildAdminSnapshot());

  ackHandler(socket, 'adminConfig:confirmPassword', requireLockdownAdministrator, async ({ password }) => {
    const admin = database.findAdministratorForAuthentication(socket?.data?.user?.username);
    if (!admin || !(await bcrypt.compare(String(password || ''), admin.passwordHash))) {
      throw new Error('Invalid credentials.');
    }
    socket.data.adminPasswordConfirmedAt = Date.now();
    return { confirmedUntil: socket.data.adminPasswordConfirmedAt + PASSWORD_CONFIRMATION_WINDOW_MS };
  });

  ackHandler(socket, 'adminConfig:updateConfiguration', requireRecentPassword, async (payload) => {
    const revision = database.updateConfiguration({
      value: payload.value,
      expectedRevision: payload.expectedRevision,
      secretOperations: payload.secretOperations,
      actor: actorFor(socket),
    });
    const application = await applyCommittedConfiguration();
    return { revision, application, snapshot: buildAdminSnapshot() };
  });

  ackHandler(socket, 'adminConfig:importConfigurationFile', requireRecentPassword, async (payload) => {
    const yamlText = String(payload.yaml || '');
    if (!yamlText || Buffer.byteLength(yamlText, 'utf8') > MAX_CONFIGURATION_FILE_BYTES) {
      throw new Error('The YAML configuration file must be present and no larger than 1 MiB.');
    }

    /*
      Parsing deliberately excludes administrators on an initialized server.
      Configuration is still filtered to today's schema and strictly
      validated, then committed through the ordinary optimistic update path so
      missing secrets survive and explicitly supplied secrets replace or clear
      their current values.
    */
    const parsed = parseConfigurationFile(yamlText, { includeAdministrators: false });
    const fileName = safeUploadedFileName(payload.fileName);
    const revision = database.updateConfiguration({
      value: parsed.config,
      expectedRevision: payload.expectedRevision,
      secretOperations: buildSecretOperationsForImport(parsed),
      actor: actorFor(socket),
      source: `admin-yaml:${fileName}`,
    });
    const application = await applyCommittedConfiguration();
    return {
      revision,
      application,
      ignoredAdministratorCount: parsed.uploadedAdministratorCount,
      snapshot: buildAdminSnapshot(),
    };
  });

  ackHandler(socket, 'adminConfig:restoreRevision', requireRecentPassword, async (payload) => {
    const revision = database.restoreConfigurationRevision({
      revision: payload.revision,
      expectedRevision: payload.expectedRevision,
      actor: actorFor(socket),
    });
    const application = await applyCommittedConfiguration();
    return { revision, application, snapshot: buildAdminSnapshot() };
  });

  ackHandler(socket, 'adminConfig:createAdministrator', requireRecentPassword, async (payload) => {
    const password = String(payload.password || '');
    if (password.length < 10) throw new Error('Administrator password must be at least 10 characters.');
    const administrator = database.createAdministrator({
      username: payload.username,
      passwordHash: await bcrypt.hash(password, 12),
      discordId: payload.discordId,
      role: payload.role,
    }, actorFor(socket));
    return { administrator, snapshot: buildAdminSnapshot() };
  });

  ackHandler(socket, 'adminConfig:updateAdministrator', requireRecentPassword, async (payload) => {
    const authenticatedAdministrator = database.findAdministratorForAuthentication(socket?.data?.user?.username);
    const changes = {
      username: payload.username,
      discordId: payload.discordId,
      role: payload.role,
    };
    if (payload.password) {
      if (String(payload.password).length < 10) throw new Error('Administrator password must be at least 10 characters.');
      changes.passwordHash = await bcrypt.hash(String(payload.password), 12);
    }
    const administrator = database.updateAdministrator(payload.id, changes, actorFor(socket));
    if (authenticatedAdministrator?.id === administrator.id) {
      /*
        Keep the current authenticated identity aligned after a self-edit. If
        the username changed but the socket retained the old name, its next
        password confirmation could never find the account it just updated.
      */
      socket.data.user = {
        ...(socket.data.user || {}),
        username: administrator.username,
        discordId: administrator.discordId,
      };
    }
    return { administrator, snapshot: buildAdminSnapshot() };
  });

  ackHandler(socket, 'adminConfig:deleteAdministrator', requireRecentPassword, ({ id }) => {
    database.deleteAdministrator(id, actorFor(socket));
    return { snapshot: buildAdminSnapshot() };
  });
});

module.exports = {
  PASSWORD_CONFIRMATION_WINDOW_MS,
  requireLockdownAdministrator,
};
