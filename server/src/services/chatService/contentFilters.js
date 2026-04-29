// Chat Content Filters
// Purpose: Provides profanity, spam, and text normalization helpers for incoming chat messages.
// Scope: Contains pure filtering logic and duplicate/keymash detectors.
const { DataSet, RegExpMatcher, englishDataset, englishRecommendedTransformers } = require('obscenity');
const { PROFANITY_ALLOWLIST, DUPLICATE_WINDOW_MS } = require('./constants');
const { lastMessageBySocket } = require('./state');

const normalizedProfanityAllowlist = new Set(
  PROFANITY_ALLOWLIST
    .filter((term) => typeof term === 'string')
    .map((term) => term.trim().toLowerCase())
    .filter(Boolean),
);

const profanityDataset = new DataSet()
  .addAll(englishDataset)
  .removePhrasesIf((phrase) => normalizedProfanityAllowlist.has(phrase.metadata?.originalWord))
  .build();

const profanityMatcher = new RegExpMatcher({
  ...profanityDataset,
  ...englishRecommendedTransformers,
  whitelistedTerms: profanityDataset.whitelistedTerms,
});

function hasProfanity(text) {
  if (typeof text !== 'string' || !text) return false;
  return profanityMatcher.hasMatch(text);
}

function isDuplicate(socketId, text) {
  const prev = lastMessageBySocket.get(socketId);
  const now = Date.now();
  if (!prev) {
    lastMessageBySocket.set(socketId, { text, ts: now });
    return false;
  }
  lastMessageBySocket.set(socketId, { text, ts: now });
  return prev.text === text && now - prev.ts <= DUPLICATE_WINDOW_MS;
}

function isKeymash(text) {
  if (!text) return false;
  if (/(.)\1{6,}/.test(text)) return true;
  if (/^[asdfghjkl;'\-=\[\]\\]{6,}$/i.test(text)) return true;
  if (/^[qwertyuiop]{6,}$/i.test(text)) return true;
  return false;
}

function normalizeUserText(raw) {
  if (typeof raw !== 'string') return '';
  return raw.replace(/\\n/g, '\n');
}

module.exports = {
  hasProfanity,
  isDuplicate,
  isKeymash,
  normalizeUserText,
};
