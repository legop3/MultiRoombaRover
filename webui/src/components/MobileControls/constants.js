// constants
// Purpose: Defines the constants module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export const SOURCE = 'mobile-drive-pad';

// The mobile pad repeats the current fixed keyboard-style command while the thumb is
// held down. The repeat keeps delayed rover/network paths fed with the same intent
// without turning touch jitter into analog speed changes.
export const DRIVE_PAD_REPEAT_MS = 100;
export const DRIVE_PAD_SPEED_MODES = [
  { id: 'precision', label: 'precision', modifierAction: 'slowModifier' },
  { id: 'normal', label: 'normal', modifierAction: null },
  { id: 'turbo', label: 'turbo', modifierAction: 'boostModifier' },
];
export const AUX_ZERO = { main: 0, side: 0, vacuum: 0 };
export const AUX_ALL_FORWARD = { main: 127, side: 127, vacuum: 127 };
export const AUX_ALL_BACKWARD = { main: -127, side: -127, vacuum: -127 };
