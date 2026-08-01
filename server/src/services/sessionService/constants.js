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
/*
  The driver ad is trusted deployment content supplied by the server operator.
  Normalize both values at the server boundary so every browser receives a
  predictable string-only contract, even when the YAML keys are absent or were
  accidentally configured with another scalar type.

  Keep the title and markup together because they describe one optional card.
  An empty HTML string disables the card; the title alone must never leave an
  empty panel at the bottom of the driver layout.
*/
const driverAd = {
  title: typeof config.driverAd?.title === 'string' ? config.driverAd.title.trim() : '',
  html: typeof config.driverAd?.html === 'string' ? config.driverAd.html.trim() : '',
};

const ACTIVITY_SYNC_COOLDOWN_MS = 3000;
const GPIO_TOGGLE_SYNC_COOLDOWN_MS = 1000;
const PERIODIC_SYNC_MS = 20000;

module.exports = {
  discordInvite,
  kofiLink,
  serverTimezone,
  configuredSocials,
  driverAd,
  ACTIVITY_SYNC_COOLDOWN_MS,
  GPIO_TOGGLE_SYNC_COOLDOWN_MS,
  PERIODIC_SYNC_MS,
};
