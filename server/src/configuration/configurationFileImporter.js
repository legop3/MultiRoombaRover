// Configuration File Importer
// Purpose: Validates one YAML file deliberately uploaded during first-run setup and stores it in the configuration database.
// Scope: This is an explicit setup action only; startup and installation never search for or consume configuration files.
const yaml = require('js-yaml');
const { normalizeConfig, assertValidConfig } = require('./validation');

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
  const config = normalizeConfig(configInput);

  /*
    Unknown fields remain in the normalized document so strict schema
    validation reports them to the operator instead of silently losing data
    from the explicitly selected file.
  */
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
