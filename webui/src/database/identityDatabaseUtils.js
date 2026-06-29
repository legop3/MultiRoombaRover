// Identity Database Utilities
// Purpose: Provides local formatting, filtering, and JSON helpers for the /database admin page.
// Scope: Avoids leaking database-editor-specific presentation helpers into shared UI modules.
export const SIGNAL_LABELS = {
  cookieUserId: 'Cookie keys',
  fingerprintId: 'Fingerprints',
  nickname: 'Nicknames',
  knownIp: 'Known IPs',
};

export const SIGNAL_FIELDS = {
  cookieUserId: 'cookieUserIds',
  fingerprintId: 'fingerprintIds',
  nickname: 'nicknames',
  knownIp: 'knownIps',
};

export function maskValue(value) {
  const text = String(value || '').trim();
  if (!text) return 'n/a';
  if (text.length <= 14) return text;
  return `${text.slice(0, 8)}...${text.slice(-6)}`;
}

export function formatDateTime(value) {
  const ts = Number(value || 0);
  if (!Number.isFinite(ts) || ts <= 0) return 'never';
  try {
    return new Intl.DateTimeFormat('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }).format(new Date(ts));
  } catch {
    return new Date(ts).toLocaleString();
  }
}

export function userMatchesQuery(user, query) {
  const needle = String(query || '').trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    user?.id,
    user?.nickname,
    ...(user?.cookieUserIds || []),
    ...(user?.fingerprintIds || []),
    ...(user?.nicknames || []),
    ...(user?.knownIps || []),
    ...(user?.featureNamespaces || []),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

export function userMatchesFilter(user, filter) {
  if (filter === 'verified') return Boolean(user?.verified?.enabled);
  if (filter === 'deterred') return Boolean(user?.deterrence?.enabled);
  if (filter === 'unverified') return !user?.verified?.enabled;
  return true;
}

export function stringifyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

export function parseEditableJson(text) {
  const parsed = JSON.parse(String(text || '').trim() || '{}');
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('JSON must be an object or array.');
  }
  return parsed;
}
