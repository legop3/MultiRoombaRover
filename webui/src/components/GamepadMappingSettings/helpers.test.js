// Controller Capture Tests
// Purpose: Verifies that binding capture cannot select held controls or swap stick axes randomly.
// Scope: Covers the pure capture detector used by the Controller settings surface.
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildDescriptorFromCapture, snapshotBaseline } from './helpers.js';

function button(pressed = false, value = pressed ? 1 : 0) {
  return { pressed, value };
}

test('a button held before capture is ignored', () => {
  const baselinePad = { axes: [0, 0], buttons: [button(true), button(false)] };
  const currentPad = { axes: [0, 0], buttons: [button(true), button(false)] };
  const descriptor = buildDescriptorFromCapture(
    currentPad,
    snapshotBaseline(baselinePad),
    { kind: 'button' },
  );
  assert.equal(descriptor, null);
});

test('axis-pair capture assigns the lower adjacent axis to X regardless of movement order', () => {
  const baseline = snapshotBaseline({ axes: [0, 0, 0, 0], buttons: [] });
  const descriptor = buildDescriptorFromCapture(
    { axes: [0, 0, -0.7, 0.9], buttons: [] },
    baseline,
    { kind: 'axisPair', invertDefaults: { invertY: true } },
  );
  assert.deepEqual(descriptor, {
    kind: 'axisPair',
    x: 2,
    y: 3,
    invertY: true,
  });
});

test('simultaneous new buttons are represented as a chord', () => {
  const baseline = snapshotBaseline({ axes: [], buttons: [button(), button(), button()] });
  const descriptor = buildDescriptorFromCapture(
    { axes: [], buttons: [button(true), button(), button(true)] },
    baseline,
    { kind: 'button' },
  );
  assert.deepEqual(descriptor, {
    kind: 'chord',
    inputs: [{ kind: 'button', index: 0 }, { kind: 'button', index: 2 }],
  });
});
