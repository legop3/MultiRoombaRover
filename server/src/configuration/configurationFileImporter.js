// Configuration File Importer
// Purpose: Validates one YAML file deliberately uploaded during first-run setup and stores it in the configuration database.
// Scope: This is an explicit setup action only; startup and installation never search for or consume configuration files.
const yaml = require('js-yaml');
const { rootSchema, normalizeConfig, assertValidConfig } = require('./validation');

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

function parseConfigurationFile(text) {
  const parsed = yaml.load(String(text || ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('The configuration file must contain a YAML object.');
  }

  const administrators = Array.isArray(parsed.admins)
    ? parsed.admins.map(normalizeUploadedAdministrator)
    : [];
  const configInput = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'admins'),
  );
  const config = normalizeConfig(keepCurrentSchemaFields(configInput, rootSchema));

  // Filtering applies only to nonexistent keys. Values retained for current
  // schema fields still have to satisfy every type, range, and format rule
  // before the importer can atomically initialize the database.
  assertValidConfig(config);
  if (!administrators.some((admin) => admin.role === 'lockdown')) {
    throw new Error('The configuration file must contain at least one lockdown administrator.');
  }
  return { config, administrators };
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
  parseConfigurationFile,
  importConfigurationFile,
};
