// Deterrence Flow Module
// Purpose: Implements deterred-user matching and moderation operations that block abusive identities.
// Scope: Owns deter/undeter logic and socket deterrence reevaluation for all connected clients.
const crypto = require('crypto');

function createDeterrenceFlow(deps) {
  const {
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
  } = deps;

  function findDeterredMatch(store, { cookieUserId, nickname, ip }) {
    const nicknameKey = normalizeNicknameKey(nickname);
    return (
      (store.deterredUsers || []).find((entry) => {
        const entryCookie = normalizeCookieUserId(entry.cookieUserId);
        if (cookieUserId && entryCookie && entryCookie === cookieUserId) return true;
        const entryIps = normalizeKnownIps(entry.knownIps);
        if (ip && entryIps.includes(ip)) return true;
        const entryNicknameKey = normalizeNicknameKey(entry.nickname);
        if (nicknameKey && entryNicknameKey && entryNicknameKey === nicknameKey) return true;
        return false;
      }) || null
    );
  }

  function reevaluateSocketDeterrence(socket) {
    if (!socket) return { isDeterred: false, matchedRecordId: null, reason: 'missing_socket' };
    const store = loadStore();
    const data = ensureSocketData(socket);
    const role = getRole(socket);
    const { cookieUserId, nickname, ip } = identityFromSocket(socket);

    if (isAdminRole(role)) {
      data.isDeterred = false;
      data.deterredRecordId = null;
      return {
        isDeterred: false,
        matchedRecordId: null,
        reason: 'admin_bypass',
        cookieUserId,
        nickname,
        ip,
      };
    }

    const match = findDeterredMatch(store, { cookieUserId, nickname, ip });
    const isDeterred = Boolean(match);
    data.isDeterred = isDeterred;
    data.deterredRecordId = isDeterred ? match.id : null;

    if (isDeterred) {
      withStore((draft) => {
        const record = (draft.deterredUsers || []).find((entry) => entry.id === match.id);
        if (!record) return;
        record.updatedAt = Date.now();
        if (cookieUserId) {
          record.cookieUserId = cookieUserId;
        }
        if (nickname) {
          record.nickname = nickname;
        }
        record.knownIps = normalizeKnownIps(record.knownIps);
        if (ip && !record.knownIps.includes(ip)) {
          record.knownIps.push(ip);
        }
      });
    }

    return {
      isDeterred,
      matchedRecordId: isDeterred ? match.id : null,
      reason: isDeterred ? 'matched' : 'no_match',
      cookieUserId,
      nickname,
      ip,
    };
  }

  function getModerationStateForSocket(socket) {
    const data = socket?.data || {};
    return {
      isDeterred: Boolean(data.isDeterred),
      recordId: data.deterredRecordId || null,
    };
  }

  function maybeResolveVerifiedRecordForSelector(store, parsed) {
    if (parsed.cookieUserId) {
      return store.verifiedUsers.find((entry) => normalizeCookieUserId(entry.cookieUserId) === parsed.cookieUserId) || null;
    }
    if (parsed.ip) {
      return store.verifiedUsers.find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(parsed.ip)) || null;
    }
    const byNickname = store.verifiedUsers.filter((entry) => normalizeNicknameKey(entry.nickname) === normalizeNicknameKey(parsed.nickname));
    if (byNickname.length === 1) return byNickname[0];
    return null;
  }

  function listDeterredUsers() {
    const store = loadStore();
    return (store.deterredUsers || []).map((entry) => ({ ...entry, knownIps: [...(entry.knownIps || [])] }));
  }

  function deterUser(selector, options = {}) {
    const parsed = parseDeterrenceSelector(selector);
    const reasonRaw = String(options?.reason || '').trim();
    const reason = reasonRaw ? reasonRaw.slice(0, 240) : null;
    const actor = options?.actor ? String(options.actor) : null;
    const now = Date.now();

    let result = null;

    withStore((draft) => {
      const verified = maybeResolveVerifiedRecordForSelector(draft, parsed);
      const cookieUserId = parsed.cookieUserId || normalizeCookieUserId(verified?.cookieUserId || '');
      const nickname = parsed.nickname || sanitizeNickname(verified?.nickname || '');
      const knownIps = normalizeKnownIps([
        ...(parsed.ip ? [parsed.ip] : []),
        ...((verified && Array.isArray(verified.knownIps)) ? verified.knownIps : []),
      ]);

      let existing = findDeterredMatch(draft, { cookieUserId, nickname, ip: parsed.ip || null });
      if (!existing && cookieUserId) {
        existing = (draft.deterredUsers || []).find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookieUserId) || null;
      }

      if (existing) {
        if (cookieUserId) {
          existing.cookieUserId = cookieUserId;
        }
        if (nickname) {
          existing.nickname = nickname;
        }
        const mergedIps = normalizeKnownIps([...(existing.knownIps || []), ...knownIps]);
        existing.knownIps = mergedIps;
        if (reason) {
          existing.reason = reason;
        }
        existing.updatedAt = now;
        existing.updatedBy = actor;
        result = { ...existing, knownIps: [...(existing.knownIps || [])], created: false };
        return;
      }

      const created = {
        id: `du_${crypto.randomBytes(8).toString('hex')}`,
        cookieUserId: cookieUserId || null,
        nickname: nickname || null,
        knownIps,
        reason,
        createdAt: now,
        createdBy: actor,
        updatedAt: now,
        updatedBy: actor,
      };
      draft.deterredUsers.push(created);
      result = { ...created, knownIps: [...(created.knownIps || [])], created: true };
    });

    io.sockets.sockets.forEach((socket) => {
      reevaluateSocketDeterrence(socket);
    });

    emitChange('deter_update');
    publishEvent({
      source: 'moderation',
      type: result?.created ? 'moderation.deterred' : 'moderation.deterrenceUpdated',
      payload: {
        id: result?.id || null,
        cookieUserId: result?.cookieUserId || null,
        nickname: result?.nickname || null,
        knownIps: result?.knownIps || [],
        reason: result?.reason || null,
        actor,
        ts: now,
      },
    });

    return result;
  }

  function resolveDeterredSelector(selector) {
    const store = loadStore();
    const value = String(selector || '').trim();
    if (!value) return { error: 'selector_required' };

    const byId = (store.deterredUsers || []).find((entry) => String(entry.id) === value) || null;
    if (byId) return { record: byId };

    const cookie = normalizeCookieUserId(value);
    if (cookie && isValidCookieUserId(cookie)) {
      const byCookie = (store.deterredUsers || []).find((entry) => normalizeCookieUserId(entry.cookieUserId) === cookie) || null;
      if (byCookie) return { record: byCookie };
    }

    const ipValue = typeof value === 'string' ? value.trim() : '';
    if (isRawIp(ipValue)) {
      const byIp =
        (store.deterredUsers || []).find((entry) => Array.isArray(entry.knownIps) && entry.knownIps.includes(ipValue)) || null;
      if (byIp) return { record: byIp };
    }

    const nicknameKey = normalizeNicknameKey(value);
    const byNickname = (store.deterredUsers || []).filter((entry) => normalizeNicknameKey(entry.nickname) === nicknameKey);
    if (byNickname.length === 1) return { record: byNickname[0] };
    if (byNickname.length > 1) return { error: 'ambiguous_nickname' };

    return { error: 'not_found' };
  }

  function undeterUser(selector, removedBy = null) {
    const resolved = resolveDeterredSelector(selector);
    if (resolved.error) {
      throw new Error(
        resolved.error === 'ambiguous_nickname'
          ? 'Nickname matches multiple deterred users; remove by id or cookieUserId.'
          : 'Deterred user not found.',
      );
    }

    const target = resolved.record;
    let removed = null;

    withStore((draft) => {
      const before = draft.deterredUsers.length;
      draft.deterredUsers = draft.deterredUsers.filter((entry) => entry.id !== target.id);
      if (draft.deterredUsers.length !== before) {
        removed = target;
      }
    });

    if (!removed) {
      throw new Error('Deterred user not found.');
    }

    io.sockets.sockets.forEach((socket) => {
      reevaluateSocketDeterrence(socket);
    });

    const removedAt = Date.now();
    emitChange('deter_remove');
    publishEvent({
      source: 'moderation',
      type: 'moderation.undeterred',
      payload: {
        id: removed.id,
        cookieUserId: removed.cookieUserId || null,
        nickname: removed.nickname || null,
        removedBy: removedBy ? String(removedBy) : null,
        removedAt,
      },
    });

    return { ...removed, knownIps: [...(removed.knownIps || [])] };
  }

  function isDeterred(socket) {
    return Boolean(socket?.data?.isDeterred);
  }

  return {
    findDeterredMatch,
    reevaluateSocketDeterrence,
    getModerationStateForSocket,
    listDeterredUsers,
    deterUser,
    undeterUser,
    isDeterred,
  };
}

module.exports = {
  createDeterrenceFlow,
};
