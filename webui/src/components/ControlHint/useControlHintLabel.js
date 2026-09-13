// Adaptive Control Hint Label Hook
// Purpose: Resolves a logical action to the keyboard or controller label appropriate for the
// operator's most recently used input device.
// Scope: Reads control/settings state only; it never captures input or dispatches rover commands.
import { useControlSelector } from '../../controls/index.js';
import { formatKeyLabel } from '../../controls/keymapUtils.js';
import { useControllerRuntime } from '../../controls/inputs/controllerRuntime.js';
import { formatControllerBinding } from '../../controls/inputs/controllerLabels.js';
import { resolveGamepadProfile } from '../../controls/inputs/gamepadBindings.js';
import { useSettingsNamespace } from '../../settings/index.js';
import { GAMEPAD_PROFILE_DEFAULT, GAMEPAD_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

export function useControlHintLabel(actionId) {
  const keyValue = useControlSelector((control) => control.state.keymap?.[actionId]?.[0]);
  const runtime = useControllerRuntime();
  const { value: gamepadSettings } = useSettingsNamespace('gamepad', GAMEPAD_SETTINGS_DEFAULTS);

  if (runtime.inputMethod !== 'controller' || !runtime.controller) {
    return formatKeyLabel(keyValue);
  }

  /* Profiles remain keyed by reusable hardware signature, while runtime controller selection is
     instance-specific. This lets two identical connected pads share a mapping without losing the
     browser slot used to decide which one currently owns control. */
  const storedProfile =
    gamepadSettings?.profiles?.[runtime.controller.signature] ??
    gamepadSettings?.defaults?.profile ??
    GAMEPAD_PROFILE_DEFAULT;
  const profile = resolveGamepadProfile(storedProfile, GAMEPAD_PROFILE_DEFAULT);
  return formatControllerBinding(profile, actionId, runtime.controller);
}
