// session Service constants
// Purpose: Defines timing and static social/config constants used by session synchronization behavior.
// Scope: Keeps runtime behavior unchanged while isolating constants from orchestration logic.
const { loadConfig } = require('../../helpers/configLoader');
const { getConfiguredSocials } = require('../../helpers/features');

const config = loadConfig();
const discordInvite = config.discord?.invite || null;
const kofiLink = config.kofi?.link || null;
const serverTimezone = config.timezone || null;
const configuredSocials = getConfiguredSocials(config);

const ACTIVITY_SYNC_COOLDOWN_MS = 3000;
const GPIO_TOGGLE_SYNC_COOLDOWN_MS = 1000;
const PERIODIC_SYNC_MS = 20000;

module.exports = {
  discordInvite,
  kofiLink,
  serverTimezone,
  configuredSocials,
  ACTIVITY_SYNC_COOLDOWN_MS,
  GPIO_TOGGLE_SYNC_COOLDOWN_MS,
  PERIODIC_SYNC_MS,
};
