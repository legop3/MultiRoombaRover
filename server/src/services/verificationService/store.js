// Verification Store Module
// Purpose: Owns persisted verification-service store loading, normalization, and immutable cloning.
// Scope: Provides a stable load/write API so higher-level verification and moderation flows stay focused.
const { resolveDataPath } = require('../../helpers/dataPaths');
const { createJsonStore } = require('../identityService');
const logger = require('../../globals/logger').child('verificationService');

const STORE_PATH = resolveDataPath('verified-users.json');

function normalizeStoreShape(store) {
  const next = store && typeof store === 'object' ? store : {};
  return {
    verifiedUsers: Array.isArray(next.verifiedUsers) ? next.verifiedUsers : [],
    pendingRequests: Array.isArray(next.pendingRequests) ? next.pendingRequests : [],
    dmMessages: Array.isArray(next.dmMessages) ? next.dmMessages : [],
    deterredUsers: Array.isArray(next.deterredUsers) ? next.deterredUsers : [],
  };
}

function cloneStore(current) {
  return {
    verifiedUsers: (current.verifiedUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] })),
    pendingRequests: (current.pendingRequests || []).map((entry) => ({ ...entry })),
    dmMessages: (current.dmMessages || []).map((entry) => ({ ...entry })),
    deterredUsers: (current.deterredUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] })),
  };
}

const storeApi = createJsonStore({
  path: STORE_PATH,
  normalizeStoreShape,
  cloneStore,
  logger,
});

module.exports = {
  loadStore: storeApi.loadStore,
  withStore: storeApi.withStore,
};
