// audio Levels Gain Math Tests
// Purpose: Pins the ceiling rules that keep user volume inside admin limits.
// Scope: Pure math only; no store, socket, or rover involvement.
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  clampFraction,
  clampGain,
  normalizeUserGains,
  normalizeGainSet,
  resolveCeilings,
  applyCeilings,
} = require('./gainMath');

const ADMIN_LIMITS = { hornGain: 0.3, ttsGain: 0.2, forwardGain: 0.1 };
const BOOST_CAPS = { hornGain: 0.5, ttsGain: 0.8, forwardGain: 0.4 };

test('an unboosted user is capped by the global admin gains', () => {
  const ceilings = resolveCeilings({ adminLimits: ADMIN_LIMITS, boostCaps: BOOST_CAPS, hasBoost: false });
  assert.deepEqual(ceilings, ADMIN_LIMITS);
});

test('the boost flag raises the ceiling to the hard caps', () => {
  const ceilings = resolveCeilings({ adminLimits: ADMIN_LIMITS, boostCaps: BOOST_CAPS, hasBoost: true });
  assert.deepEqual(ceilings, BOOST_CAPS);
});

test('the boost flag never lowers a ceiling when admin gains exceed the caps', () => {
  const loud = { hornGain: 2, ttsGain: 1.5, forwardGain: 3 };
  const ceilings = resolveCeilings({ adminLimits: loud, boostCaps: BOOST_CAPS, hasBoost: true });
  assert.deepEqual(ceilings, loud);
});

test('a full personal slider resolves to exactly the ceiling', () => {
  const effective = applyCeilings({ hornGain: 1, ttsGain: 1, forwardGain: 1 }, ADMIN_LIMITS);
  assert.deepEqual(effective, ADMIN_LIMITS);
});

test('a personal slider scales the ceiling rather than replacing it', () => {
  const effective = applyCeilings({ hornGain: 0.5, ttsGain: 0.5, forwardGain: 0.5 }, BOOST_CAPS);
  assert.deepEqual(effective, { hornGain: 0.25, ttsGain: 0.4, forwardGain: 0.2 });
});

test('an out-of-range personal value cannot escape the ceiling', () => {
  const effective = applyCeilings({ hornGain: 12, ttsGain: -4, forwardGain: 'loud' }, ADMIN_LIMITS);
  assert.equal(effective.hornGain, ADMIN_LIMITS.hornGain);
  assert.equal(effective.ttsGain, 0);
  // A non-numeric value falls back to the full slider, still bounded by the ceiling.
  assert.equal(effective.forwardGain, ADMIN_LIMITS.forwardGain);
});

test('a zero admin gain silences even a boosted user at full slider', () => {
  const ceilings = resolveCeilings({
    adminLimits: { hornGain: 0, ttsGain: 0, forwardGain: 0 },
    boostCaps: { hornGain: 0, ttsGain: 0, forwardGain: 0 },
    hasBoost: true,
  });
  assert.deepEqual(applyCeilings({ hornGain: 1, ttsGain: 1, forwardGain: 1 }, ceilings), {
    hornGain: 0,
    ttsGain: 0,
    forwardGain: 0,
  });
});

test('personal values normalize into the 0..1 range with a full-volume default', () => {
  assert.deepEqual(normalizeUserGains({ hornGain: 0.25, ttsGain: 9 }), {
    hornGain: 0.25,
    ttsGain: 1,
    forwardGain: 1,
  });
});

test('gain sets normalize into the 0..4 range and fall back per key', () => {
  assert.deepEqual(normalizeGainSet({ hornGain: 9, ttsGain: 'x' }, BOOST_CAPS), {
    hornGain: 4,
    ttsGain: BOOST_CAPS.ttsGain,
    forwardGain: BOOST_CAPS.forwardGain,
  });
});

test('clamps reject non-finite input by returning the supplied fallback', () => {
  assert.equal(clampGain(Number.NaN, 0.7), 0.7);
  assert.equal(clampGain(Infinity, 0.7), 0.7);
  assert.equal(clampFraction(undefined, 0.4), 0.4);
});
