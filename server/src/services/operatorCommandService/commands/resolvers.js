// Operator Command Resolvers
// Purpose: Provides shared selector parsing and fuzzy matching for command handlers.
// Scope: Keeps potentially destructive commands from each inventing their own lookup rules.
const Fuse = require('fuse.js');
const { normalizeIp } = require('../../../helpers/ipResolver');

const FUZZY_THRESHOLD = 0.38;
const AMBIGUOUS_SCORE_GAP = 0.08;
const MAX_SUGGESTIONS = 5;

function normalizeText(value) {
  return String(value || '').trim();
}

function normalizeSearchText(value) {
  return normalizeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function compactJoin(parts, separator = ', ') {
  return (Array.isArray(parts) ? parts : []).map(normalizeText).filter(Boolean).join(separator);
}

function uniqueBy(items, getKey) {
  const seen = new Set();
  const out = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = getKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out;
}

function buildResultError(kind, label, candidates = []) {
  const suggestions = uniqueBy(candidates, (entry) => entry.key).slice(0, MAX_SUGGESTIONS);
  const suffix = suggestions.length
    ? ` Suggestions: ${compactJoin(suggestions.map((entry) => entry.label || entry.key))}.`
    : '';
  if (kind === 'ambiguous') return `${label} matched multiple records.${suffix}`;
  return `${label} not found.${suffix}`;
}

function resolveRoverSelector(selector, rovers) {
  const query = normalizeText(selector);
  if (!query) return { error: 'Specify a rover.' };

  const candidates = Array.from(rovers.values()).map((record) => {
    const id = normalizeText(record?.id);
    const name = normalizeText(record?.meta?.name || record?.name || id);
    return {
      key: id,
      id,
      label: name,
      record,
      searchId: normalizeSearchText(id),
      searchLabel: normalizeSearchText(name),
    };
  }).filter((entry) => entry.id);

  const normalized = normalizeSearchText(query);
  const exact = candidates.filter((entry) => entry.searchId === normalized || entry.searchLabel === normalized);
  if (exact.length === 1) return { record: exact[0].record, id: exact[0].id, label: exact[0].label };
  if (exact.length > 1) return { error: buildResultError('ambiguous', 'Rover', exact) };

  const fuse = new Fuse(candidates, {
    includeScore: true,
    threshold: FUZZY_THRESHOLD,
    ignoreLocation: true,
    keys: [
      { name: 'label', weight: 0.65 },
      { name: 'id', weight: 0.35 },
    ],
  });
  const results = fuse.search(query);
  if (!results.length) return { error: buildResultError('not_found', 'Rover', candidates) };

  const first = results[0];
  const second = results[1];
  // Fuzzy matches are allowed for convenience, but destructive commands should
  // not act when two targets are similarly plausible. The score gap keeps typo
  // tolerance without turning near-ties into accidental locks or removals.
  if (second && Math.abs(Number(second.score || 0) - Number(first.score || 0)) < AMBIGUOUS_SCORE_GAP) {
    return { error: buildResultError('ambiguous', 'Rover', results.map((entry) => entry.item)) };
  }
  return { record: first.item.record, id: first.item.id, label: first.item.label };
}

function createIdentityCandidates(records = [], { includeId = true } = {}) {
  return (Array.isArray(records) ? records : []).map((record) => {
    const id = normalizeText(record?.id);
    const userId = normalizeText(record?.userId);
    const cookieUserId = normalizeText(record?.cookieUserId);
    const fingerprintId = normalizeText(record?.fingerprintId);
    const nickname = normalizeText(record?.nickname);
    const knownIps = Array.isArray(record?.knownIps) ? record.knownIps.map(normalizeText).filter(Boolean) : [];
    return {
      key: userId || id || cookieUserId || fingerprintId || nickname,
      id,
      userId,
      cookieUserId,
      fingerprintId,
      nickname,
      knownIps,
      label: compactJoin([nickname || 'unknown', includeId && (userId || id) ? (userId || id) : '', cookieUserId ? mask(cookieUserId) : '']),
      record,
      searchId: normalizeSearchText(id),
      searchUserId: normalizeSearchText(userId),
      searchCookie: normalizeSearchText(cookieUserId),
      searchFingerprint: normalizeSearchText(fingerprintId),
      searchNickname: normalizeSearchText(nickname),
      searchIps: knownIps.map(normalizeSearchText),
    };
  }).filter((entry) => entry.key);
}

function resolveIdentitySelector(selector, records = [], options = {}) {
  const query = normalizeText(selector);
  if (!query) return { error: 'Selector required.' };

  const candidates = createIdentityCandidates(records, options);
  const normalized = normalizeSearchText(query);
  const ip = normalizeIp(query);

  const exact = candidates.filter((entry) => (
    entry.searchId === normalized ||
    entry.searchUserId === normalized ||
    entry.searchCookie === normalized ||
    entry.searchFingerprint === normalized ||
    entry.searchNickname === normalized ||
    (ip && entry.searchIps.includes(normalizeSearchText(ip)))
  ));
  if (exact.length === 1) return { record: exact[0].record, label: exact[0].label };
  if (exact.length > 1) return { error: buildResultError('ambiguous', 'Selector', exact) };

  const fuse = new Fuse(candidates, {
    includeScore: true,
    threshold: FUZZY_THRESHOLD,
    ignoreLocation: true,
    keys: [
      { name: 'nickname', weight: 0.78 },
      { name: 'cookieUserId', weight: 0.12 },
      { name: 'fingerprintId', weight: 0.08 },
      { name: 'id', weight: 0.08 },
      { name: 'knownIps', weight: 0.02 },
    ],
  });
  const results = fuse.search(query);
  if (!results.length) return { error: buildResultError('not_found', 'Selector', candidates) };

  const first = results[0];
  const second = results[1];
  if (second && Math.abs(Number(second.score || 0) - Number(first.score || 0)) < AMBIGUOUS_SCORE_GAP) {
    return { error: buildResultError('ambiguous', 'Selector', results.map((entry) => entry.item)) };
  }
  return { record: first.item.record, label: first.item.label };
}

function mask(v) {
  const key = normalizeText(v);
  if (!key) return 'n/a';
  if (key.length <= 10) return `${key.slice(0, 2)}***${key.slice(-2)}`;
  return `${key.slice(0, 6)}...${key.slice(-6)}`;
}

module.exports = {
  compactJoin,
  mask,
  normalizeText,
  normalizeSearchText,
  resolveIdentitySelector,
  resolveRoverSelector,
};
