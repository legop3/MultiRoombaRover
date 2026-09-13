// Controller Prompt Label Tests
// Purpose: Protect the adapter between persisted rover actions and the third-party controller
// model database, including manual prompt families and directional fallback aliases.
import test from 'node:test';
import assert from 'node:assert/strict';
import { GAMEPAD_PROFILE_DEFAULT } from '../../settings/namespaces.js';
import { formatControllerBinding } from './controllerLabels.js';

test('uses the manually selected PlayStation button family', () => {
  const profile = { ...GAMEPAD_PROFILE_DEFAULT, promptStyle: 'playstation-dual-sense' };
  const label = formatControllerBinding(profile, 'vacuum', {
    id: 'Controller hidden by browser privacy mode',
    mapping: 'standard',
  });

  assert.equal(label, 'X');
});

test('falls back from a keyboard direction action to its controller axis', () => {
  const label = formatControllerBinding(GAMEPAD_PROFILE_DEFAULT, 'driveForward', {
    id: 'Xbox Wireless Controller',
    mapping: 'standard',
  });

  assert.equal(label, 'Left stick ↑');
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

  assert.equal(label, 'D-pad right');
});
