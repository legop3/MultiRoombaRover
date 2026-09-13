// Gamepad Binding Tests
// Purpose: Locks down the safety-critical conversion from browser values to logical actions.
// Scope: Exercises pure binding behavior without mounting React or opening a real controller.
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  advanceCameraAngle,
  computeGamepadOutputs,
  resolveGamepadProfile,
} from './gamepadBindings.js';
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

test('tank steering preserves independent left and right wheel requests', () => {
  const tankProfile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    calibration: {
      ...GAMEPAD_PROFILE_DEFAULT.calibration,
      driveMode: 'tank',
    },
  };

  const forward = computeGamepadOutputs(pad({ axes: [0, -1, 0, -1] }), tankProfile);
  assert.deepEqual(forward.tankTracks, { left: 1, right: 1 });
  assert.deepEqual(forward.driveVector, { x: 0, y: 1, boost: false });

  const pivotRight = computeGamepadOutputs(pad({ axes: [0, -1, 0, 1] }), tankProfile);
  assert.deepEqual(pivotRight.tankTracks, { left: 1, right: -1 });
  assert.deepEqual(pivotRight.driveVector, { x: 1, y: 0, boost: false });

  const leftOnly = computeGamepadOutputs(pad({ axes: [0, -1, 0, 0] }), tankProfile);
  assert.deepEqual(leftOnly.driveVector, { x: 0.5, y: 0.5, boost: false });
});

test('tank steering applies deadzone and remapping to each track independently', () => {
  const tankProfile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    calibration: {
      ...GAMEPAD_PROFILE_DEFAULT.calibration,
      driveMode: 'tank',
      driveDeadzone: 0.2,
    },
    bindings: {
      ...GAMEPAD_PROFILE_DEFAULT.bindings,
      tankLeft: { kind: 'axis', sources: [{ kind: 'axis', index: 0, invert: false }] },
      tankRight: { kind: 'axis', sources: [{ kind: 'axis', index: 2, invert: true }] },
    },
  };

  /* The left track is inside its own deadzone while the remapped right track reaches full output;
     movement on one side must not pull the other side through a shared radial threshold. */
  const output = computeGamepadOutputs(pad({ axes: [0.1, 0, -1, 0] }), tankProfile);
  assert.deepEqual(output.tankTracks, { left: 0, right: 1 });
  assert.deepEqual(output.driveVector, { x: -0.5, y: 0.5, boost: false });
});

test('tank camera buttons form one signed camera axis without playing song notes', () => {
  const tankProfile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    calibration: {
      ...GAMEPAD_PROFILE_DEFAULT.calibration,
      driveMode: 'tank',
    },
  };

  const up = computeGamepadOutputs(pad({ pressed: [12] }), tankProfile);
  assert.equal(up.cameraAxis, 1);
  assert.equal(up.buttons.tankCameraUp, true);
  assert.equal(up.buttons.songNoteUp, false);

  const down = computeGamepadOutputs(pad({ pressed: [13] }), tankProfile);
  assert.equal(down.cameraAxis, -1);
  assert.equal(down.buttons.tankCameraDown, true);
  assert.equal(down.buttons.songNoteDown, false);

  const cancelled = computeGamepadOutputs(pad({ pressed: [12, 13] }), tankProfile);
  assert.equal(cancelled.cameraAxis, 0);
});

test('single-stick mode keeps analog camera and song buttons separate', () => {
  const output = computeGamepadOutputs(
    pad({ axes: [0, 0, 0, -1], pressed: [12] }),
    GAMEPAD_PROFILE_DEFAULT,
  );

  assert.equal(output.cameraAxis, 1);
  assert.equal(output.buttons.songNoteUp, true);
  assert.equal(output.buttons.tankCameraUp, false);
});

test('recommended standard-layout buttons resolve to the intended rover actions', () => {
  const output = computeGamepadOutputs(
    pad({ pressed: [0, 2, 4, 5, 9, 10, 15] }),
    GAMEPAD_PROFILE_DEFAULT,
  );

  assert.equal(output.buttons.allAux, true);
  assert.equal(output.buttons.vacuum, false);
  assert.equal(output.buttons.hornHonk, true);
  assert.equal(output.buttons.headlightToggle, true);
  assert.equal(output.buttons.laserToggle, true);
  assert.equal(output.buttons.driveMacro, true);
  assert.equal(output.buttons.slowModifier, true);
  assert.equal(output.buttons.homeAssistantOn, true);
  assert.equal(output.buttons.mainReverse, false);
  assert.equal(output.buttons.sideReverse, false);
  assert.equal(output.buttons.boostModifier, false);
});

test('button chords require every constituent input', () => {
  const profile = resolveGamepadProfile({
    behaviorVersion: GAMEPAD_PROFILE_DEFAULT.behaviorVersion,
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
    behaviorVersion: GAMEPAD_PROFILE_DEFAULT.behaviorVersion,
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
  const resolved = resolveGamepadProfile({
    behaviorVersion: GAMEPAD_PROFILE_DEFAULT.behaviorVersion,
    bindings: { drive: customDrive },
  }, GAMEPAD_PROFILE_DEFAULT);

  assert.deepEqual(resolved.bindings.drive, customDrive);
  assert.ok(resolved.bindings.hornHonk);
});

test('profile upgrade discards detector-specific prompt values', () => {
  const resolved = resolveGamepadProfile({
    behaviorVersion: 2,
    promptStyle: 'playstation-dual-sense',
  }, GAMEPAD_PROFILE_DEFAULT);

  assert.equal(resolved.behaviorVersion, GAMEPAD_PROFILE_DEFAULT.behaviorVersion);
  assert.equal(resolved.promptStyle, 'auto');
  assert.deepEqual(resolved.bindings.allAux, GAMEPAD_PROFILE_DEFAULT.bindings.allAux);
  assert.deepEqual(resolved.bindings.headlightToggle, GAMEPAD_PROFILE_DEFAULT.bindings.headlightToggle);
});

test('absolute camera mode always uses its fixed 0.01 deadzone', () => {
  const profile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    calibration: {
      ...GAMEPAD_PROFILE_DEFAULT.calibration,
      cameraMode: 'absolute',
      cameraDeadzone: 0.4,
    },
  };

  const inside = computeGamepadOutputs(pad({ axes: [0, 0, 0, -0.005] }), profile);
  const outside = computeGamepadOutputs(pad({ axes: [0, 0, 0, -0.02] }), profile);
  assert.equal(inside.cameraAxis, 0);
  assert.ok(outside.cameraAxis > 0.01);
});

test('velocity camera accumulation clamps at the servo limit and reverses immediately', () => {
  const atUpperLimit = advanceCameraAngle(45, 1, 180, 50, { min: -45, max: 45 });
  const reversing = advanceCameraAngle(atUpperLimit, -1, 180, 50, { min: -45, max: 45 });

  assert.equal(atUpperLimit, 45);
  assert.equal(reversing, 36);
});
