// Verification Service Module
// Purpose: Composes verification identity, request, and moderation deterrence flows into one public service API.
// Scope: Exposes stable verification operations while delegating behavior to focused submodules.
const EventEmitter = require('events');
const io = require('../../globals/io');
const logger = require('../../globals/logger').child('verificationService');
const { publishEvent } = require('../eventBus');
const { getNickname, setNickname } = require('../nicknameService');
const { getRole, roleEvents } = require('../roleService');

const { loadStore, withStore } = require('./store');
const {
  ensureSocketData,
  identityFromSocket,
  normalizeNicknameKey,
  normalizeKnownIps,
  isAdminRole,
  parseDeterrenceSelector,
  isRawIp,
  normalizeCookieUserId,
  isValidCookieUserId,
  generateCookieUserId,
  sanitizeNickname,
} = require('./identity');
const { createVerificationFlow } = require('./verificationFlow');
const { createDeterrenceFlow } = require('./deterrenceFlow');
const { createRequestFlow } = require('./requestFlow');
const { registerVerificationHooks } = require('./hooks');

const verificationEvents = new EventEmitter();
const IDENTITY_TIMEOUT_MS = 2 * 60 * 1000;
const IDENTITY_SWEEP_INTERVAL_MS = 15 * 1000;

function emitChange(reason, payload = {}) {
  verificationEvents.emit('change', { reason, ...payload });
}

let reevaluateSocketVerification = () => ({ isVerified: false, matchedRecordId: null, reason: 'not_initialized' });
let reevaluateSocketDeterrence = () => ({ isDeterred: false, matchedRecordId: null, reason: 'not_initialized' });

const verificationFlow = createVerificationFlow({
  loadStore,
  withStore,
  io,
  publishEvent,
  emitChange,
  getRole,
  getNickname,
  ensureSocketData,
  identityFromSocket,
  normalizeCookieUserId,
  sanitizeNickname,
  reevaluateSocketDeterrence: (...args) => reevaluateSocketDeterrence(...args),
});
reevaluateSocketVerification = verificationFlow.reevaluateSocketVerification;

const deterrenceFlow = createDeterrenceFlow({
  loadStore,
  withStore,
  io,
  publishEvent,
  emitChange,
  getRole,
  ensureSocketData,
  identityFromSocket,
  normalizeNicknameKey,
  normalizeKnownIps,
  isAdminRole,
  parseDeterrenceSelector,
  isRawIp,
  normalizeCookieUserId,
  isValidCookieUserId,
  sanitizeNickname,
  findVerifiedMatch: verificationFlow.findVerifiedMatch,
});
reevaluateSocketDeterrence = deterrenceFlow.reevaluateSocketDeterrence;

const requestFlow = createRequestFlow({
  loadStore,
  withStore,
  io,
  publishEvent,
  emitChange,
  ensureSocketData,
  identityFromSocket,
  isValidCookieUserId,
  normalizeCookieUserId,
  reevaluateSocketVerification,
  reevaluateSocketDeterrence,
});

function identifySocket(socket, payload = {}) {
  if (!socket) {
    throw new Error('Socket required');
  }
  const data = ensureSocketData(socket);
  const incomingKey = normalizeCookieUserId(payload.cookieUserId);
  if (incomingKey && !isValidCookieUserId(incomingKey)) {
    throw new Error('Invalid identity key format.');
  }
  const currentKey = normalizeCookieUserId(data.cookieUserId);
  const safeCurrentKey = isValidCookieUserId(currentKey) ? currentKey : '';
  data.cookieUserId = incomingKey || safeCurrentKey || generateCookieUserId();

  const incomingNickname = sanitizeNickname(payload.nickname);
  if (incomingNickname) {
    try {
      if (incomingNickname !== getNickname(socket)) {
        setNickname(socket, incomingNickname);
      }
    } catch (err) {
      logger.warn('Failed to set nickname from identify', err.message);
    }
  }

  if (Object.prototype.hasOwnProperty.call(payload, 'overseerEnabled')) {
    data.overseerEnabled = Boolean(payload.overseerEnabled);
  } else if (typeof data.overseerEnabled !== 'boolean') {
    data.overseerEnabled = true;
  }

  const verification = reevaluateSocketVerification(socket);
  const deterrence = reevaluateSocketDeterrence(socket);
  emitChange('identify', { socketId: socket.id });
  return {
    cookieUserId: data.cookieUserId,
    overseerEnabled: Boolean(data.overseerEnabled),
    isVerified: verification.isVerified,
    isDeterred: deterrence.isDeterred,
    reason: verification.reason,
    identifiedAt: Date.now(),
  };
}

function getVerificationStateForSocket(socket) {
  return verificationFlow.getVerificationStateForSocket(socket, requestFlow.getPendingRequestForIdentity);
}

registerVerificationHooks({
  io,
  roleEvents,
  logger,
  identifySocket,
  createVerificationRequest: requestFlow.createVerificationRequest,
  reevaluateSocketVerification,
  reevaluateSocketDeterrence,
  emitChange,
});

setInterval(() => {
  const now = Date.now();
  io.sockets.sockets.forEach((socket) => {
    if (!socket?.id) return;
    const role = getRole(socket);
    if (role === 'admin' || role === 'lockdown') return;
    const connectedAt = Number(socket?.data?.connectedAt || 0);
    const lastClientIdentifyAt = Number(socket?.data?.lastClientIdentifyAt || 0);
    const referenceTs = lastClientIdentifyAt || connectedAt;
    if (!referenceTs) return;
    if (now - referenceTs < IDENTITY_TIMEOUT_MS) return;
    logger.info('Disconnecting socket due to stale identity heartbeat', {
      socketId: socket.id,
      role,
      ageMs: now - referenceTs,
      hadClientIdentify: Boolean(lastClientIdentifyAt),
    });
    socket.disconnect(true);
  });
}, IDENTITY_SWEEP_INTERVAL_MS);

module.exports = {
  identifySocket,
  getVerificationStatus: verificationFlow.getVerificationStatus,
  getIdentitySummary: verificationFlow.getIdentitySummary,
  getVerificationStateForSocket,
  getModerationStateForSocket: deterrenceFlow.getModerationStateForSocket,
  createVerificationRequest: requestFlow.createVerificationRequest,
  attachDmMessage: requestFlow.attachDmMessage,
  getRequestByMessageId: requestFlow.getRequestByMessageId,
  approveRequest: requestFlow.approveRequest,
  denyRequest: requestFlow.denyRequest,
  listVerifiedUsers: verificationFlow.listVerifiedUsers,
  removeVerifiedUser: verificationFlow.removeVerifiedUser,
  listDeterredUsers: deterrenceFlow.listDeterredUsers,
  deterUser: deterrenceFlow.deterUser,
  undeterUser: deterrenceFlow.undeterUser,
  isVerified: verificationFlow.isVerified,
  isDeterred: deterrenceFlow.isDeterred,
  reevaluateSocketVerification,
  reevaluateSocketDeterrence,
  verificationEvents,
};
