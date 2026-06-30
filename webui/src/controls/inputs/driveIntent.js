// Drive Intent Helpers
// Purpose: Shares keyboard-style drive intent math between physical keyboard input and mobile thumb controls.
// Scope: Converts active key tokens into normalized drive vectors, auxiliary motor values, and speed options.
import { INPUT_SETTINGS_DEFAULTS } from '../../settings/namespaces.js';

export function clampKeyboardSpeed(value, fallback) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.max(0, Math.min(500, num));
}

export function resolveKeyboardSpeeds(inputSettings) {
  const defaults = INPUT_SETTINGS_DEFAULTS.keyboard;
  const current = inputSettings?.keyboard ?? {};
  return {
    baseSpeed: clampKeyboardSpeed(current.baseSpeed, defaults.baseSpeed),
    turboSpeed: clampKeyboardSpeed(current.turboSpeed, defaults.turboSpeed),
    precisionSpeed: clampKeyboardSpeed(current.precisionSpeed, defaults.precisionSpeed),
  };
}

export function bindingActive(bindingSet, keys) {
  if (!bindingSet || bindingSet.size === 0) return false;
  for (const key of keys) {
    if (bindingSet.has(key)) return true;
  }
  return false;
}

export function computeKeyboardDriveVector(keys, keymap) {
  const forward = bindingActive(keymap.driveForward, keys);
  const backward = bindingActive(keymap.driveBackward, keys);
  const left = bindingActive(keymap.driveLeft, keys);
  const right = bindingActive(keymap.driveRight, keys);
  const boost = bindingActive(keymap.boostModifier, keys);
  const slow = bindingActive(keymap.slowModifier, keys);

  let y = 0;
  if (forward && !backward) y = 1;
  else if (backward && !forward) y = -1;

  let x = 0;
  if (left && !right) x = -1;
  else if (right && !left) x = 1;

  // The keyboard precision modifier intentionally reduces the vector as well as the
  // speed cap. Mobile precision mode uses the same path so thumb driving feels like
  // holding the same keyboard modifier, not like a separate mobile-only tune.
  const scale = slow ? 0.4 : 1;
  return {
    x: x * scale,
    y: y * scale,
    boost: boost && !slow,
  };
}

export function isPrecisionDriveActive(keys, keymap) {
  /*
    The slow modifier is the canonical precision-drive signal shared by physical
    keyboard input and the mobile pad's virtual-key path. Centralizing the check
    keeps camera precision coupled to the same driver intent instead of copying
    modifier-specific knowledge into each caller.
  */
  return bindingActive(keymap?.slowModifier, keys);
}

export function computeKeyboardAuxMotors(keys, keymap) {
  const allForward = bindingActive(keymap.auxAllForward, keys);
  if (allForward) {
    return { main: 127, side: 127, vacuum: 127 };
  }
  const main = bindingActive(keymap.auxMainForward, keys)
    ? 127
    : bindingActive(keymap.auxMainReverse, keys)
    ? -127
    : 0;
  const side = bindingActive(keymap.auxSideForward, keys)
    ? 127
    : bindingActive(keymap.auxSideReverse, keys)
    ? -70
    : 0;
  const vacuum = bindingActive(keymap.auxVacuumFast, keys)
    ? 127
    : bindingActive(keymap.auxVacuumSlow, keys)
    ? 50
    : 0;
  return { main, side, vacuum };
}

export function getKeyboardDriveSpeedOptions(keys, keymap, keyboardSpeeds) {
  const slowActive = isPrecisionDriveActive(keys, keymap);
  return slowActive
    ? { baseSpeed: keyboardSpeeds.precisionSpeed, boostSpeed: keyboardSpeeds.precisionSpeed }
    : { baseSpeed: keyboardSpeeds.baseSpeed, boostSpeed: keyboardSpeeds.turboSpeed };
}
