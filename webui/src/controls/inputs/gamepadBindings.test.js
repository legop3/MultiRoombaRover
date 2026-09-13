// Gamepad Binding Tests
// Purpose: Locks down the safety-critical conversion from browser values to logical actions.
// Scope: Exercises pure binding behavior without mounting React or opening a real controller.
import assert from 'node:assert/strict';
import test from 'node:test';
import { computeGamepadOutputs, resolveGamepadProfile } from './gamepadBindings.js';
import { GAMEPAD_PROFILE_DEFAULT } from '../../settings/namespaces.js';

function pad({ axes = [0, 0, 0, 0], pressed = [], values = {} } = {}) {
  return {
    axes,
    buttons: Array.from({ length: 18 }, (_, index) => ({
      pressed: pressed.includes(index),
      value: values[index] ?? (pressed.includes(index) ? 1 : 0),
    })),
  };
}

test('radial drive deadzone removes drift and rescales real movement', () => {
  const idle = computeGamepadOutputs(pad({ axes: [0.1, -0.1, 0, 0] }), GAMEPAD_PROFILE_DEFAULT);
  assert.deepEqual(idle.driveVector, { x: 0, y: 0, boost: false });

  const moving = computeGamepadOutputs(pad({ axes: [0, -0.59, 0, 0] }), GAMEPAD_PROFILE_DEFAULT);
  assert.equal(moving.driveVector.x, 0);
  assert.ok(moving.driveVector.y > 0.49 && moving.driveVector.y < 0.51);
});

test('button chords require every constituent input', () => {
  const profile = resolveGamepadProfile({
    bindings: {
      hornHonk: {
        kind: 'button',
        sources: [{
          kind: 'chord',
          inputs: [{ kind: 'button', index: 4 }, { kind: 'button', index: 0 }],
        }],
      },
    },
  }, GAMEPAD_PROFILE_DEFAULT);

  assert.equal(computeGamepadOutputs(pad({ pressed: [4] }), profile).buttons.hornHonk, false);
  assert.equal(computeGamepadOutputs(pad({ pressed: [4, 0] }), profile).buttons.hornHonk, true);
});

test('multiple button sources behave as alternatives instead of first-source-only fallbacks', () => {
  const profile = resolveGamepadProfile({
    bindings: {
      laserToggle: {
        kind: 'button',
        sources: [{ kind: 'button', index: 2 }, { kind: 'button', index: 7 }],
      },
    },
  }, GAMEPAD_PROFILE_DEFAULT);

  assert.equal(computeGamepadOutputs(pad({ pressed: [7] }), profile).buttons.laserToggle, true);
});

test('profile resolution adds new actions without overwriting customized bindings', () => {
  const customDrive = {
    kind: 'axisPair',
    sources: [{ kind: 'axisPair', x: 2, y: 3, invertX: true, invertY: false }],
  };
  const resolved = resolveGamepadProfile({ bindings: { drive: customDrive } }, GAMEPAD_PROFILE_DEFAULT);

  assert.deepEqual(resolved.bindings.drive, customDrive);
  assert.ok(resolved.bindings.hornHonk);
});
