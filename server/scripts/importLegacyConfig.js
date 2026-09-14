#!/usr/bin/env node
// Legacy Configuration Import Command
// Purpose: Imports or validates an explicitly selected YAML file before normal database-only startup.
// Scope: Provides recovery/unattended migration using the same importer as first-run setup.
const fs = require('fs');
const path = require('path');
const { getConfigurationDatabase } = require('../src/configuration');
const { importLegacyConfiguration } = require('../src/configuration/legacyImporter');

function usage() {
  process.stderr.write('Usage: node scripts/importLegacyConfig.js <config.yaml> [--dry-run]\n');
}

function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const selectedPath = args.find((arg) => arg !== '--dry-run');
  if (!selectedPath) {
    usage();
    process.exitCode = 2;
    return;
  }

  const absolutePath = path.resolve(selectedPath);
  const text = fs.readFileSync(absolutePath, 'utf8');
  const result = importLegacyConfiguration({
    text,
    database: getConfigurationDatabase(),
    actor: 'command-line-import',
    source: path.basename(absolutePath),
    dryRun,
  });

  /*
    Never print parsed configuration values: the legacy document commonly
    contains Discord, Home Assistant, and camera credentials. A concise count
    and revision are sufficient for an unattended migration log.
  */
  process.stdout.write(`${dryRun ? 'Legacy configuration is valid' : 'Legacy configuration imported'}: ${result.administratorCount} administrator(s)${result.revision ? `, revision ${result.revision}` : ''}.\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`Legacy configuration import failed: ${error.message}\n`);
  if (Array.isArray(error.validationErrors)) {
    error.validationErrors.forEach((entry) => process.stderr.write(`- ${entry.path}: ${entry.message}\n`));
  }
  process.exitCode = 1;
}
