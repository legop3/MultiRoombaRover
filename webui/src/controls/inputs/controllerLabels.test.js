// Controller Prompt Label Tests
// Purpose: Protect the adapter between persisted rover actions and the third-party controller
// model database, including manual prompt families and directional fallback aliases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPAD_PROFILE_DEFAULT } from '../../settings/namespaces.js';
import { describeController, formatControllerBinding } from './controllerLabels.js';

test('uses the manually selected PlayStation button family', () => {
  const profile = { ...GAMEPAD_PROFILE_DEFAULT, promptStyle: 'playstation' };
  const label = formatControllerBinding(profile, 'vacuum', {
    id: 'Controller hidden by browser privacy mode',
    mapping: 'standard',
  });

  assert.equal(label, '○');
});

test('recognizes the exact Linux DualSense browser identifier', () => {
  const controller = {
    id: '054c-0ce6-Sony Interactive Entertainment DualSense Wireless Controller',
    mapping: 'standard',
  };

  assert.equal(describeController(controller).description, 'Sony DualSense (PS5)');
  assert.equal(formatControllerBinding(GAMEPAD_PROFILE_DEFAULT, 'vacuum', controller), '○');
  assert.equal(formatControllerBinding(GAMEPAD_PROFILE_DEFAULT, 'allAux', controller), '×');
});

test('falls back from a keyboard direction action to its controller axis', () => {
  const label = formatControllerBinding(GAMEPAD_PROFILE_DEFAULT, 'driveForward', {
    id: 'Xbox Wireless Controller',
    mapping: 'standard',
  });

  assert.equal(label, 'LS ↑');
});

test('tank steering prompts show both track directions compactly', () => {
  const profile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    calibration: {
      ...GAMEPAD_PROFILE_DEFAULT.calibration,
      driveMode: 'tank',
    },
  };
  const controller = { id: 'Xbox Wireless Controller', mapping: 'standard' };

  assert.equal(formatControllerBinding(profile, 'driveForward', controller), 'LS ↑ + RS ↑');
  assert.equal(formatControllerBinding(profile, 'driveLeft', controller), 'LS ↓ + RS ↑');
  assert.equal(formatControllerBinding(profile, 'cameraUp', controller), 'D↑');
  assert.equal(formatControllerBinding(profile, 'cameraDown', controller), 'D↓');
});

test('a direct digital aux binding takes priority over its analog fallback', () => {
  const profile = {
    ...GAMEPAD_PROFILE_DEFAULT,
    bindings: {
      ...GAMEPAD_PROFILE_DEFAULT.bindings,
      auxMainReverse: { kind: 'button', sources: [{ kind: 'button', index: 15 }] },
    },
  };
  const label = formatControllerBinding(profile, 'auxMainReverse', {
    id: 'Xbox Wireless Controller',
    mapping: 'standard',
  });

  assert.equal(label, 'D→');
});
