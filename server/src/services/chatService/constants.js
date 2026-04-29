// Chat Service Constants
// Purpose: Defines chat moderation, history, and UX timing constants used across chat modules.
// Scope: Centralizes immutable runtime tuning values for message and typing behavior.
const RATE_LIMIT_WINDOW_MS = 8000;
const RATE_LIMIT_MAX = 5;
const MAX_HISTORY = 100;
const PROFANITY_ALLOWLIST = ['fuck', 'ass', 'shit'];
const DUPLICATE_WINDOW_MS = 15000;
const TYPING_START_NOTE = 72;
const TYPING_SEND_NOTE = 79;
const TYPING_NOTE_DURATION = 8;
const ACCESS_NOTICE_COOLDOWN_MS = 60000;
const ACCESS_KEYWORD_RE = /\b(drive|roomba)\b/i;

module.exports = {
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  MAX_HISTORY,
  PROFANITY_ALLOWLIST,
  DUPLICATE_WINDOW_MS,
  TYPING_START_NOTE,
  TYPING_SEND_NOTE,
  TYPING_NOTE_DURATION,
  ACCESS_NOTICE_COOLDOWN_MS,
  ACCESS_KEYWORD_RE,
};
