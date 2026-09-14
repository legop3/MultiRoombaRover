// Configuration System Tests
// Purpose: Verifies strict defaults, immutable revisions, secret handling, explicit setup-file import, and administrator safety.
// Scope: Uses isolated temporary databases and never opens the development server's data store.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { defaultConfig, normalizeConfig, assertValidConfig } = require('./validation');
const { definitions, rootSchema, secretPaths, featureDefinitions } = require('./definition');
const { getFeatureFlags } = require('./index');
const { createConfigurationDatabase } = require('./database');
const { parseConfigurationFile, importConfigurationFile } = require('./configurationFileImporter');

const temporaryRoots = [];

function createTestDatabase() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'multirover-configuration-'));
  temporaryRoots.push(root);
  return createConfigurationDatabase({ databasePath: path.join(root, 'configuration.sqlite') });
}

function collectUndocumentedSchemaPaths(schema, pathLabel = '$') {
  /*
    The admin editor is entirely schema-generated, so missing schema prose is
    missing operator documentation. Walk objects, arrays, array item schemas,
    and scalar leaves instead of checking only named service definitions; this
    makes every visible level of the hierarchy uphold the same contract.
  */
  if (!schema || typeof schema !== 'object') return [];
  const missing = typeof schema.description === 'string' && schema.description.trim()
    ? []
    : [pathLabel];

  if (schema.properties) {
    Object.entries(schema.properties).forEach(([key, childSchema]) => {
      missing.push(...collectUndocumentedSchemaPaths(childSchema, `${pathLabel}.${key}`));
    });
  }
  if (schema.items) {
    missing.push(...collectUndocumentedSchemaPaths(schema.items, `${pathLabel}[]`));
  }
  return missing;
}

function collectSchemaPathsMissingInputExamples(schema, value, pathLabel = '$', insideArray = false) {
  /*
    Universal defaults such as timeouts and modes are real saved values. Empty
    strings and newly-created array items are different: they require an
    installation-specific value, so the admin form must show an example without
    persisting a fake hostname, credential, or hardware ID. This walk enforces
    that distinction across both the current default document and array shapes.
  */
  if (!schema || typeof schema !== 'object') return [];

  if (schema.type === 'array') {
    return collectSchemaPathsMissingInputExamples(schema.items, undefined, `${pathLabel}[]`, true);
  }

  if (schema.type === 'object') {
    return Object.entries(schema.properties || {}).flatMap(([key, childSchema]) => (
      collectSchemaPathsMissingInputExamples(childSchema, value?.[key], `${pathLabel}.${key}`, insideArray)
    ));
  }

  // Enumerations and checkboxes already communicate their accepted shape
  // through their controls, so placeholder examples are only required for
  // otherwise free-form empty scalar inputs.
  const needsExample = (value === '' || insideArray)
    && !Array.isArray(schema.enum)
    && schema.type !== 'boolean';
  if (!needsExample) return [];
  return Array.isArray(schema.examples) && schema.examples.length ? [] : [pathLabel];
}

test.after(() => {
  temporaryRoots.forEach((root) => fs.rmSync(root, { recursive: true, force: true }));
});

test('safe defaults form a complete valid configuration with integrations disabled', () => {
  assert.doesNotThrow(() => assertValidConfig(defaultConfig));
  assert.equal(defaultConfig.discord.enabled, false);
  assert.equal(defaultConfig.homeAssistant.enabled, false);
  assert.equal(defaultConfig.ptzCamera.enabled, false);
  assert.equal(defaultConfig.balanceBoard.enabled, false);
});

test('service definitions determine document order and write-only secret handling', () => {
  /*
    The generic browser form and backend persistence both consume this one
    assembled schema. Guarding composition order and derived secret paths here
    prevents either consumer from needing its own parallel registry.
  */
  assert.deepEqual(Object.keys(defaultConfig), definitions.map(({ key }) => key));
  assert.deepEqual(Object.keys(rootSchema.properties), Object.keys(defaultConfig));
  assert.deepEqual(secretPaths, ['homeAssistant.token', 'ptzCamera.password', 'discord.token']);
  assert.equal(rootSchema.properties.homeAssistant.properties.token.writeOnly, true);
  assert.equal(rootSchema.properties.ptzCamera.properties.password.writeOnly, true);
  assert.equal(rootSchema.properties.discord.properties.token.writeOnly, true);
});

test('every configuration section, collection, item, and option has an operator description', () => {
  /*
    New configuration remains self-documenting by default. Reporting every
    dotted path in one assertion gives a contributor an exact repair list and
    avoids recreating a separately maintained documentation registry.
  */
  assert.deepEqual(collectUndocumentedSchemaPaths(rootSchema), []);
});

test('empty installation-specific fields and array item inputs provide schema-owned examples', () => {
  /*
    The frontend derives placeholders from these examples generically. Keeping
    this assertion beside schema composition prevents an empty, unexplained box
    from returning when a service adds configuration in the future.
  */
  assert.deepEqual(collectSchemaPathsMissingInputExamples(rootSchema, defaultConfig), []);
});

test('service definitions generate public feature paths without a separate registry', () => {
  /*
    This order follows the one configuration document, including nested Neato
    and lift definitions beneath Home Assistant. The assertion makes duplicate,
    omitted, or centrally reintroduced feature names visible during review.
  */
  assert.deepEqual(featureDefinitions, [
    { key: 'interInstance', path: ['interInstance', 'enabled'] },
    { key: 'barcodeGames', path: ['barcodeGames', 'enabled'] },
    { key: 'homeAssistant', path: ['homeAssistant', 'enabled'] },
    { key: 'neato', path: ['homeAssistant', 'neato', 'enabled'] },
    { key: 'lift', path: ['homeAssistant', 'lift', 'enabled'] },
    { key: 'roomCameras', path: ['roomCameras', 'enabled'] },
    { key: 'ptzCamera', path: ['ptzCamera', 'enabled'] },
    { key: 'kinect', path: ['kinect', 'enabled'] },
    { key: 'balanceBoard', path: ['balanceBoard', 'enabled'] },
    { key: 'buttonBox', path: ['buttonBox', 'enabled'] },
    { key: 'barcodeScanner', path: ['barcodeScanner', 'enabled'] },
    { key: 'discord', path: ['discord', 'enabled'] },
    { key: 'socials', path: ['socials', 'enabled'] },
    { key: 'fleetReports', path: ['fleetReports', 'enabled'] },
  ]);
});

test('generated feature flags use only each declared enabled switch', () => {
  /*
    This deliberately describes services without usable credentials, devices,
    or enabled parents. Readiness belongs to runtime health, so the generated
    public flags must still preserve each operator-selected switch exactly.
  */
  const flags = getFeatureFlags({
    homeAssistant: {
      enabled: false,
      lift: { enabled: true },
      neato: { enabled: true },
    },
    roomCameras: { enabled: true, cameras: [] },
    barcodeScanner: { enabled: false },
    barcodeGames: { enabled: true },
    socials: { enabled: true, links: [] },
    ptzCamera: { enabled: true, host: '', username: '', password: '' },
    discord: { enabled: true, token: '' },
  });

  assert.equal(flags.homeAssistant, false);
  assert.equal(flags.lift, true);
  assert.equal(flags.neato, true);
  assert.equal(flags.roomCameras, true);
  assert.equal(flags.barcodeScanner, false);
  assert.equal(flags.barcodeGames, true);
  assert.equal(flags.socials, true);
  assert.equal(flags.ptzCamera, true);
  assert.equal(flags.discord, true);
});

test('normalization fills missing legacy fields but strict validation rejects unknown fields', () => {
  const normalized = normalizeConfig({ media: { whepBaseUrl: 'http://localhost:8889/video' } });
  assert.deepEqual(normalized.media.additionalHosts, []);
  assert.doesNotThrow(() => assertValidConfig(normalized));

  const invalid = normalizeConfig({ media: { whepBaseUrl: 'http://localhost:8889/video', misspelledHost: 'x' } });
  assert.throws(() => assertValidConfig(invalid), (error) => {
    assert.equal(error.code, 'CONFIG_VALIDATION_FAILED');
    assert.ok(error.validationErrors.some((entry) => entry.path.includes('misspelledHost')));
    return true;
  });
});

test('full-document updates preserve secrets and reject a stale browser revision', () => {
  const database = createTestDatabase();
  const initial = database.getActiveConfigurationRecord();
  const tokenRevision = database.updateConfiguration({
    value: database.getClientConfiguration().config,
    expectedRevision: initial.revision,
    actor: 'test',
    secretOperations: {
      'discord.token': { action: 'replace', value: 'super-secret-token' },
    },
  });

  const client = database.getClientConfiguration();
  assert.equal(client.config.discord.token, '');
  assert.equal(client.configuredSecrets['discord.token'], true);
  const editedConfiguration = structuredClone(client.config);
  editedConfiguration.discord.enabled = true;
  const nextRevision = database.updateConfiguration({
    value: editedConfiguration,
    expectedRevision: tokenRevision,
    actor: 'test',
  });
  assert.equal(database.getActiveConfigurationRecord().config.discord.token, 'super-secret-token');
  assert.throws(() => database.updateConfiguration({
    value: editedConfiguration,
    expectedRevision: tokenRevision,
    actor: 'stale-test',
  }), (error) => error.code === 'CONFIG_REVISION_CONFLICT' && error.currentRevision === nextRevision);

  const rollbackRevision = database.restoreConfigurationRevision({
    revision: tokenRevision,
    expectedRevision: nextRevision,
    actor: 'rollback-test',
  });
  assert.ok(rollbackRevision > nextRevision);
  assert.equal(database.getActiveConfigurationRecord().config.discord.enabled, false);
  database.close();
});

test('administrator storage never exposes hashes or removes the final lockdown administrator', () => {
  const database = createTestDatabase();
  const lockdown = database.createAdministrator({
    username: 'owner',
    passwordHash: '$2b$10$example',
    role: 'lockdown',
  });
  const listed = database.listAdministrators();
  assert.equal(listed.length, 1);
  assert.equal(Object.hasOwn(listed[0], 'passwordHash'), false);
  assert.throws(() => database.deleteAdministrator(lockdown.id, 'test'), /final lockdown administrator/);
  assert.throws(() => database.updateAdministrator(lockdown.id, { role: 'admin' }, 'test'), /final lockdown administrator/);
  database.close();
});

test('an explicitly uploaded YAML file imports configuration and bcrypt hashes exactly once', () => {
  const yamlText = `
admins:
  - username: owner
    password_hash: "$2b$10$preservedHash"
    discord_id: "1234"
    lockdown: true
timezone: America/Chicago
media:
  whepBaseUrl: http://localhost:8889/video
`;
  const parsed = parseConfigurationFile(yamlText);
  assert.equal(parsed.config.timezone, 'America/Chicago');
  assert.equal(parsed.administrators[0].passwordHash, '$2b$10$preservedHash');

  const database = createTestDatabase();
  const result = importConfigurationFile({ text: yamlText, database });
  assert.equal(result.administratorCount, 1);
  assert.equal(database.findAdministratorForAuthentication('OWNER').passwordHash, '$2b$10$preservedHash');
  assert.throws(() => importConfigurationFile({ text: yamlText, database }), /cannot replace an initialized installation/);
  database.close();
});
