// session Service constants
// Purpose: Defines timing and static social/config constants used by session synchronization behavior.
// Scope: Keeps runtime behavior unchanged while isolating constants from orchestration logic.
const { loadConfig } = require('../../configuration');
const { getConfiguredSocials } = require('./configuration');

function getServerTimezone() {
  return loadConfig().timezone || null;
}

function getConfiguredSessionSocials() {
  return getConfiguredSocials(loadConfig());
}
/*
  The driver ad is trusted deployment content supplied by the server operator.
  Normalize both values at the server boundary so every browser receives a
  predictable string-only contract at the session boundary.

  Keep the title and markup together because they describe one optional card.
  An empty HTML string disables the card; the title alone must never leave an
  empty panel at the bottom of the driver layout.
*/
function getDriverAd() {
  const configured = loadConfig().driverAd;
  return {
    title: typeof configured?.title === 'string' ? configured.title.trim() : '',
    html: typeof configured?.html === 'string' ? configured.html.trim() : '',
  };
}

const ACTIVITY_SYNC_COOLDOWN_MS = 3000;
const GPIO_TOGGLE_SYNC_COOLDOWN_MS = 1000;
const PERIODIC_SYNC_MS = 20000;

module.exports = {
  getServerTimezone,
  getConfiguredSessionSocials,
  getDriverAd,
  ACTIVITY_SYNC_COOLDOWN_MS,
  GPIO_TOGGLE_SYNC_COOLDOWN_MS,
  PERIODIC_SYNC_MS,
};
