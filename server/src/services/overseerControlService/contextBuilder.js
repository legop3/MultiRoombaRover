const { evaluateTools } = require('./tools');

function normalizeNeatoIssue(value) {
  const raw = String(value || '').trim();
  if (!raw) return 'none';
  if (raw.includes('200')) return 'none';
  return raw;
}

function toStateUpdate({ mode, homeAssistantState, neatoState, liftState, roster, triggerReason }) {
  const lines = [];
  lines.push(`trigger: ${triggerReason || '