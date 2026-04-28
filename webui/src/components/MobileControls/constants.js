// constants
// Purpose: Defines the constants module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export const SOURCE = 'mobile-joystick';
export const JOYSTICK_RADIUS = 80;
export const JOYSTICK_SMOOTHING = 0.15;
export const AUX_ZERO = { main: 0, side: 0, vacuum: 0 };
export const AUX_ALL_FORWARD = { main: 127, side: 127, vacuum: 127 };
export const AUX_ALL_BACKWARD = { main: -127, side: -127, vacuum: -127 };
