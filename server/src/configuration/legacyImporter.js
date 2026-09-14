// Legacy YAML Configuration Importer
// Purpose: Converts one explicitly supplied config.yaml document into the database-backed configuration model.
// Scope: Parses and validates legacy input without becoming a runtime fallback or watcher.
const yaml = require('js-yaml');
const { normalizeConfig, assertValidConfig } = require('./validation');

function normalizeLegacyAdministrator(entry, index) {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new Error(`Legacy administrator ${index + 1} must be an object.`);
  }
  const username = String(entry.username || '').trim();
  const passwordHash = String(entry.password_hash || '').trim();
  if (!username || !passwordHash) {
    throw new Error(`Legacy administrator ${index + 1} requires username and password_hash.`);
  }
  return {
    username,
    passwordHash,
    discordId: String(entry.discord_id || '').trim(),
    role: entry.lockdown ? 'lockdown' : 'admin',
  };
}

function parseLegacyConfiguration(text) {
  const parsed = yaml.load(String(text || ''));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Legacy configuration must contain a YAML object.');
  }

  const administrators = Array.isArray(parsed.admins)
    ? parsed.admins.map(normalizeLegacyAdministrator)
    : [];
  const configInput = Object.fromEntries(
    Object.entries(parsed).filter(([key]) => key !== 'admins'),
  );
  const config = normalizeConfig(configInput);

  /*
    Unknown fields are retained by normalizeConfig and therefore appear in
    Ajv's precise validation errors instead of being silently discarded during
    the one-time import.
  */
  assertValidConfig(config);
  if (!administrators.some((admin) => admin.role === 'lockdown')) {
    throw new Error('Legacy configuration must contain at least one lockdown administrator.');
  }
  return { config, administrators };
}

function importLegacyConfiguration({ text, database, actor = 'legacy-import', source = 'config.yaml', dryRun = false }) {
  const result = parseLegacyConfiguration(text);
  if (dryRun) {
    return {
      dryRun: true,
      administratorCount: result.administrators.length,
    };
  }
  const revision = database.importLegacy({
    config: result.config,
    administrators: result.administrators,
    actor,
    source,
  });
  return {
    dryRun: false,
    revision,
    administratorCount: result.administrators.length,
  };
}

module.exports = {
  parseLegacyConfiguration,
  importLegacyConfiguration,
};
