// Verification Flow Module
// Purpose: Implements verified-user matching, socket verification state reevaluation, and verified roster operations.
// Scope: Owns all behavior related to who is considered verified and how verified records are listed or removed.
function createVerificationFlow(deps) {
  const {
    loadStore,
    withStore,
    io,
    publishEvent,
    emitChange,
    getRole,
    ensureSocketData,
    identityFromSocket,
    normalizeCookieUserId,
    sanitizeNickname,
    getNickname,
    reevaluateSocketDeterrence,
  } = deps;

  function findVerifiedMatch(store, { cookieUserId, ip }) {
    if (!cookieUserId && !ip) return null;
    const byCookie = cookieUserId
      ? store.verifiedUsers.find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookieUserId) || null
      : null;
    if (byCookie) return byCookie;
    if (!ip) return null;
    return store.verifiedUsers.find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(ip)) || null;
  }

  function reevaluateSocketVerification(socket) {
    if (!socket) return { isVerified: false, matchedRecordId: null, reason: 'missing_socket' };
    const store = loadStore();
    const data = ensureSocketData(socket);
    const role = getRole(socket);
    const { cookieUserId, nickname, ip } = identityFromSocket(socket);

    if (role === 'lockdown') {
      data.isVerified = true;
      data.verifiedRecordId = null;
      return {
        isVerified: true,
        matchedRecordId: null,
        reason: 'lockdown_admin',
        cookieUserId,
        nickname,
        ip,
      };
    }

    const match = findVerifiedMatch(store, { cookieUserId, ip });
    const nicknameMatches = Boolean(match && nickname && sanitizeNickname(match.nickname) === nickname);

    let isVerified = false;
    let reason = 'no_match';
    if (match && nicknameMatches) {
      isVerified = true;
      reason = 'matched';
    } else if (match && !nicknameMatches) {
      reason = 'nickname_mismatch';
    }

    data.isVerified = isVerified;
    data.verifiedRecordId = isVerified ? match.id : null;

    if (isVerified) {
      withStore((draft) => {
        const record = draft.verifiedUsers.find((entry) => entry.id === match.id);
        if (!record) return;
        record.updatedAt = Date.now();
        record.nickname = nickname;
        if (ip && !record.knownIps.includes(ip)) {
          record.knownIps.push(ip);
        }
      });
    }

    return {
      isVerified,
      matchedRecordId: isVerified ? match.id : null,
      reason,
      cookieUserId,
      nickname,
      ip,
    };
  }

  function getVerificationStatus(socket) {
    const data = socket?.data || {};
    return {
      isVerified: Boolean(data.isVerified),
      recordId: data.verifiedRecordId || null,
    };
  }

  function getIdentitySummary(socket) {
    const data = socket?.data || {};
    return {
      cookieUserId: normalizeCookieUserId(data.cookieUserId) || null,
      nickname: getNickname(socket) || null,
      overseerEnabled: typeof data.overseerEnabled === 'boolean' ? data.overseerEnabled : true,
    };
  }

  function listVerifiedUsers() {
    const store = loadStore();
    return store.verifiedUsers.map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] }));
  }

  function resolveVerifiedUserSelector(selector) {
    const value = String(selector || '').trim();
    if (!value) return { error: 'selector_required' };
    const store = loadStore();
    const byCookie = store.verifiedUsers.find((entry) => entry.cookieUserId === value) || null;
    if (byCookie) return { record: byCookie };
    const byNickname = store.verifiedUsers.filter((entry) => sanitizeNickname(entry.nickname) === sanitizeNickname(value));
    if (byNickname.length === 1) return { record: byNickname[0] };
    if (byNickname.length > 1) return { error: 'ambiguous_nickname' };
    return { error: 'not_found' };
  }

  function removeVerifiedUser(selector, removedBy = null) {
    const resolved = resolveVerifiedUserSelector(selector);
    if (resolved.error) {
      throw new Error(
        resolved.error === 'ambiguous_nickname'
          ? 'Nickname matches multiple users; remove by cookieUserId.'
          : 'Verified user not found.',
      );
    }
    const target = resolved.record;
    let removed = null;
    withStore((draft) => {
      const before = draft.verifiedUsers.length;
      draft.verifiedUsers = draft.verifiedUsers.filter((entry) => entry.id !== target.id);
      if (draft.verifiedUsers.length !== before) {
        removed = target;
      }
    });
    if (!removed) {
      throw new Error('Verified user not found.');
    }

    io.sockets.sockets.forEach((socket) => {
      const data = ensureSocketData(socket);
      if (normalizeCookieUserId(data.cookieUserId) === removed.cookieUserId) {
        reevaluateSocketVerification(socket);
        reevaluateSocketDeterrence(socket);
      }
    });

    emitChange('remove', { cookieUserId: removed.cookieUserId });
    publishEvent({
      source: 'verification',
      type: 'verification.userRemoved',
      payload: {
        cookieUserId: removed.cookieUserId,
        nickname: removed.nickname,
        removedBy,
        removedAt: Date.now(),
      },
    });

    return removed;
  }

  function getVerificationStateForSocket(socket, getPendingRequestForIdentity) {
    const identity = getIdentitySummary(socket);
    const pending = getPendingRequestForIdentity(identity.cookieUserId);
    return {
      isVerified: Boolean(socket?.data?.isVerified),
      pendingRequestId: pending?.id || null,
      pendingRequestedAt: pending?.createdAt || null,
    };
  }

  function isVerified(socket) {
    return Boolean(socket?.data?.isVerified);
  }

  return {
    findVerifiedMatch,
    reevaluateSocketVerification,
    getVerificationStatus,
    getIdentitySummary,
    listVerifiedUsers,
    resolveVerifiedUserSelector,
    removeVerifiedUser,
    getVerificationStateForSocket,
    isVerified,
  };
}

module.exports = {
  createVerificationFlow,
};
