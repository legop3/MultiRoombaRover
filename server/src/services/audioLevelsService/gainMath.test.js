// Audio Adjustment Math Tests
// Purpose: Pins percentage clamping and conversion independently of sockets, identity, and rover IO.
// Scope: Covers only the pure rules used by audioLevelsService.
const test = require('node:test');
const assert = require('node:assert/strict');
const { clampMaximumAdjustmentPercent, normalizeAdjustments, applyAdjustments } = require('./gainMath');

test('the configured range is a whole percentage from zero through one hundred', () => {
  assert.equal(clampMaximumAdjustmentPercent(-5), 0);
  assert.equal(clampMaximumAdjustmentPercent(32.6), 33);
  assert.equal(clampMaximumAdjustmentPercent(500), 100);
});

test('each browser percentage is clamped equally in both directions', () => {
  assert.deepEqual(normalizeAdjustments({ hornPercent: -80, ttsPercent: 10, forwardPercent: 90 }, 40), {
    hornPercent: -40,
    ttsPercent: 10,
    forwardPercent: 40,
  });
});

test('signed percentages adjust each server base gain', () => {
  assert.deepEqual(
    applyAdjustments(
      { hornGain: 1, ttsGain: 2, forwardGain: 0.5 },
      { hornPercent: -25, ttsPercent: 25, forwardPercent: 40 },
    ),
    { hornGain: 0.75, ttsGain: 2.5, forwardGain: 0.7 },
  );
});

test('effective gains remain inside the rover hard bounds', () => {
  assert.deepEqual(
    applyAdjustments({ hornGain: 4, ttsGain: 0, forwardGain: 3 }, { hornPercent: 100, ttsPercent: -100, forwardPercent: 100 }),
    { hornGain: 4, ttsGain: 0, forwardGain: 4 },
  );
});
