// llm Commentary Service constants
// Purpose: Centralizes static limits, prompt path, and timing defaults used by commentary runtime.
// Scope: Keeps runtime behavior unchanged by moving immutable values and normalization helper into one module.
const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', '..', '..', 'prompts', 'commentary_system.txt');
const DEFAULT_FREQUENCY_MS = 0;
const MIN_FREQUENCY_MS = 0;
const JITTER_MS = 0;
const MAX_ROVERS = 6;
const MAX_CHAT_MESSAGES = 4;
const MAX_BOT_MESSAGES = 1;
const ACTIVITY_WINDOW_MS = 60000;
const ACTIVITY_BUCKET_MS = 1000;
const ACTIVITY_SCORE_WINDOW_MS = 30000;
const SELF_TALK_WINDOW_MS = 30 * 60 * 1000;
const MAX_CONTEXT_EVENTS = 8;
const MAX_RUN_HISTORY = 100;
const MAX_ROVER_EVENTS = 400;
const POST_COOLDOWN_MS = 10000;

function normalizeFrequencyMs(value) {
  if (!Number.isFinite(value)) return DEFAULT_FREQUENCY_MS;
  // If frequency is configured as a small integer, treat it as seconds for convenience.
  const parsed = value > 0 && value < 1000 ? value * 1000 : value;
  return Math.max(MIN_FREQUENCY_MS, Math.floor(parsed));
}

module.exports = {
  PROMPT_PATH,
  DEFAULT_FREQUENCY_MS,
  MIN_FREQUENCY_MS,
  JITTER_MS,
  MAX_ROVERS,
  MAX_CHAT_MESSAGES,
  MAX_BOT_MESSAGES,
  ACTIVITY_WINDOW_MS,
  ACTIVITY_BUCKET_MS,
  ACTIVITY_SCORE_WINDOW_MS,
  SELF_TALK_WINDOW_MS,
  MAX_CONTEXT_EVENTS,
  MAX_RUN_HISTORY,
  MAX_ROVER_EVENTS,
  POST_COOLDOWN_MS,
  normalizeFrequencyMs,
};
