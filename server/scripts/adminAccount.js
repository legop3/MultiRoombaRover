#!/usr/bin/env node
// Administrator Recovery Command
// Purpose: Creates or resets a lockdown administrator when web authentication cannot be repaired through /admin.
// Scope: Performs one explicit local database mutation and never creates a recurring startup bypass.
const bcrypt = require('bcrypt');
const { getConfigurationDatabase } = require('../src/configuration');

function usage() {
  process.stderr.write('Usage: node scripts/adminAccount.js <username> <password> [discord-id]\n');
}

async function main() {
  const [username, password, discordId = ''] = process.argv.slice(2);
  if (!username || !password) {
    usage();
    process.exitCode = 2;
    return;
  }
  if (password.length < 10) throw new Error('Administrator password must be at least 10 characters.');

  const database = getConfigurationDatabase();
  const existing = database.findAdministratorForAuthentication(username);
  const passwordHash = await bcrypt.hash(password, 12);
  if (existing) {
    database.updateAdministrator(existing.id, { passwordHash, role: 'lockdown', discordId }, 'command-line-recovery');
    process.stdout.write(`Reset lockdown administrator ${existing.username}.\n`);
    return;
  }
  const created = database.createAdministrator({ username, passwordHash, discordId, role: 'lockdown' }, 'command-line-recovery');
  process.stdout.write(`Created lockdown administrator ${created.username}.\n`);
}

main().catch((error) => {
  process.stderr.write(`Administrator recovery failed: ${error.message}\n`);
  process.exitCode = 1;
});
