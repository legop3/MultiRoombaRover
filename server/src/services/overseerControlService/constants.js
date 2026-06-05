const path = require('path');

const PROMPT_PATH = path.join(__dirname, '..', '..', '..', 'prompts', 'overseer_control_system.txt');
const DEFAULT_NAME = 'The Overseer';
const DEFAULT_GATE_INTERVAL_MS = 2000;
const MIN_INTERVAL_MS = 250;
const MAX_RUN_HISTORY = 100;
const MAX_CHAT_CONTEXT = 12;
const MAX_BOT_CONTEXT = 2;

function normalizeMs(value, fallback) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(MIN_INTERVAL_MS, Math.floor(value));
}

module.exports = {
  PROMPT_PATH,
  DEFAULT_NAME,
  DEFAULT_GATE_INTERVAL_MS,
  MAX_RUN_HISTORY,
  MAX_CHAT_CONTEXT,
  MAX_BOT_CONTEXT,
  normalizeMs,
};
