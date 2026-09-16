// Configuration File Importer
// Purpose: Validates a deliberately uploaded legacy YAML file for first-run setup or an explicit administrative replacement.
// Scope: Startup and installation never search for or consume configuration files; every import begins with a browser-selected file.
const yaml = require('js-yaml');
const {
  rootSchema,
  secretPaths,
  normalizeConfig,
  assertValidConfig,
} = require('./validation');

const MAX_CONFIGURATION_FILE_BYTES = 1024 * 1024;

function getAtPath(object, dottedPath) {
  return String(dottedPath || '').split('.').filter(Boolean)
    .reduce((value, key) => value?.[key], object);
}

function setAtPath(object, dottedPath, value) {
  const parts = String(dottedPath || '').split('.').filter(Boolean);
  let cursor = object;
  parts.slice(0, -1).forEach((key) => {
    cursor = cursor[key];
  });
  cursor[parts.at(-1)] = value;
}

function hasAtPath(object, dottedPath) {
  /*
    Presence, rather than truthiness, distinguishes an omitted legacy secret
    from an explicitly empty one. An omitted credential must preserve the
    running installation's value, while an empty YAML value deliberately
    clears it through the same operation used by the schema form.
  */
  let cursor = object;
  for (const key of String(dottedPath || '').split('.').filter(Boolean)) {
    if (cursor === null || typeof cursor !== 'object' || !Object.hasOwn(cursor, key)) return false;
    cursor = cursor[key];
  }
  return true;
}

function keepCurrentSchemaFields(value, schema) {
  /*
    An uploaded file is only a convenient seed for the current configuration;
    it is not a second schema or a historical migration framework. Legacy YAML
    was permissive, so real installations naturally contain keys left behind
    by removed features. At object boundaries, copy only properties that exist
    in today's schema and recursively apply the same rule to nested objects and
    array items. Known fields retain their original values and are validated
    normally afterward, so this cannot hide a malformed current setting.
  */
  if (schema?.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
    return Object.fromEntries(Object.entries(schema.properties || {})
      .filter(([key]) => Object.hasOwn(value, key))
      .map(([key, childSchema]) => [key, keepCurrentSchemaFields(value[key], childSchema)]));
  }

  if (schema?.type === 'array') {
    if (!Array.isArray(value)) return value;
    return value.map((item) => keepCurrentSchemaFields(item, schema.items));
  }

  return value;
}

function normalizeUploadedAdministrator(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Administrator ${index + 1} must be an object.`);
  }
  const username = String(entry.username || '').trim();
  const passwordHash = String(entry.password_hash || '').trim();
  if (!username || !passwordHash) {
    throw new Error(`Administrator ${index + 1} requires username and password_hash.`);
  }
  return {
    username,
    passwordHash,
    discordId: String(entry.discord_id || '').trim(),
    role: entry.lockdown ? 'lockdown' : 'admin',
  };
}

function parseConfigurationFile(text, { includeAdministrators = true } = {}) {
  const parsed = yaml.load(String(text || ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The configuration file must contain a YAML object.');
  }

  const uploadedAdministrators = Array.isArray(parsed.admins) ? parsed.admins : [];
  /*
    First-run setup is the sole workflow allowed to create accounts from the
    legacy file. An initialized server ignores the entire admins collection,
    including obsolete or malformed entries, so importing configuration can
    never rename accounts, replace password hashes, or remove the last
    lockdown administrator.
  */
  const administrators = includeAdministrators
    ? uploadedAdministrators.map(normalizeUploadedAdministrator)
    : [];
  const configInput = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'admins'),
  );
  secretPaths.forEach((secretPath) => {
    /*
      YAML commonly represents `token:` as null even though the application
      models an unconfigured credential as an empty string. Translate null only
      for known secret fields so a plainly empty legacy credential has the same
      clear meaning as the admin form; null in any ordinary current field still
      fails its schema normally.
    */
    if (hasAtPath(configInput, secretPath) && getAtPath(configInput, secretPath) === null) {
      setAtPath(configInput, secretPath, '');
    }
  });
  const config = normalizeConfig(keepCurrentSchemaFields(configInput, rootSchema));
  const providedSecretPaths = secretPaths.filter((secretPath) => hasAtPath(configInput, secretPath));

  // Filtering applies only to nonexistent keys. Values retained for current
  // schema fields still have to satisfy every type, range, and format rule
  // before the importer can atomically initialize the database.
  assertValidConfig(config);
  return {
    config,
    administrators,
    uploadedAdministratorCount: uploadedAdministrators.length,
    providedSecretPaths,
  };
}

function buildSecretOperationsForImport({ config, providedSecretPaths = [] }) {
  return Object.fromEntries(providedSecretPaths.map((secretPath) => {
    const value = getAtPath(config, secretPath);
    /*
      Current secret schemas are strings. Keeping this conversion beside the
      importer produces the database's narrow replace/clear contract and
      avoids granting the import route a way around ordinary secret handling.
    */
    return value === ''
      ? [secretPath, { action: 'clear' }]
      : [secretPath, { action: 'replace', value }];
  }));
}

function importConfigurationFile({ text, database, actor = 'setup-file-upload', source = 'uploaded-config.yaml' }) {
  const result = parseConfigurationFile(text);
  const revision = database.importConfigurationFile({
    config: result.config,
    administrators: result.administrators,
    actor,
    source,
  });
  return {
    revision,
    administratorCount: result.administrators.length,
  };
}

module.exports = {
  MAX_CONFIGURATION_FILE_BYTES,
  parseConfigurationFile,
  buildSecretOperationsForImport,
  importConfigurationFile,
};
