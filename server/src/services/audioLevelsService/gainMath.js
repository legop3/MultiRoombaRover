// Audio Adjustment Math
// Purpose: Converts signed browser percentages into server-enforced rover gain multipliers.
// Scope: Contains no IO or identity logic so the adjustment policy can be tested independently.
const ADJUSTMENT_FIELDS = [
  { gainKey: 'hornGain', percentKey: 'hornPercent' },
  { gainKey: 'ttsGain', percentKey: 'ttsPercent' },
  { gainKey: 'forwardGain', percentKey: 'forwardPercent' },
];
const MIN_GAIN = 0;
const MAX_GAIN = 4;
const MIN_ADJUSTMENT_PERCENT = -100;
const MAX_ADJUSTMENT_PERCENT = 100;

function clampGain(value, fallback = 1) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(MIN_GAIN, Math.min(MAX_GAIN, number));
}

function clampMaximumAdjustmentPercent(value, fallback = 50) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.round(Math.max(0, Math.min(MAX_ADJUSTMENT_PERCENT, number)));
}

function clampAdjustmentPercent(value, maximum = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  const limit = clampMaximumAdjustmentPercent(maximum, 0);
  return Math.round(Math.max(-limit, Math.min(limit, number)));
}

function normalizeAdjustments(raw = {}, maximum = 0) {
  const normalized = {};
  ADJUSTMENT_FIELDS.forEach(({ percentKey }) => {
    normalized[percentKey] = clampAdjustmentPercent(raw?.[percentKey], maximum);
  });
  return normalized;
}

function applyAdjustments(baseLevels = {}, adjustments = {}) {
  const effective = {};
  ADJUSTMENT_FIELDS.forEach(({ gainKey, percentKey }) => {
    const base = clampGain(baseLevels?.[gainKey], 0);
    const percentage = Math.max(MIN_ADJUSTMENT_PERCENT, Math.min(MAX_ADJUSTMENT_PERCENT, Number(adjustments?.[percentKey]) || 0));
    effective[gainKey] = clampGain(base * (1 + percentage / 100), 0);
  });
  return effective;
}

module.exports = {
  ADJUSTMENT_FIELDS,
  MIN_GAIN,
  MAX_GAIN,
  MIN_ADJUSTMENT_PERCENT,
  MAX_ADJUSTMENT_PERCENT,
  clampGain,
  clampMaximumAdjustmentPercent,
  clampAdjustmentPercent,
  normalizeAdjustments,
  applyAdjustments,
};
