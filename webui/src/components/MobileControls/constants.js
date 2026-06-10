// constants
// Purpose: Defines the constants module and the local helpers/components used in this file.
// Scope: Keeps behavior unchanged while isolating this concern into a clear, single-responsibility unit.
export const SOURCE = 'mobile-joystick';
// The visual base ring is drawn from this same value, so the driver's thumb reaches
// "full stick" when the UI also shows the knob at the edge. The previous math used
// a larger invisible radius than the drawn ring, which made intentional full turns
// require more thumb travel than the control appeared to promise.
export const JOYSTICK_RADIUS = 64;

// Mobile pointer events can arrive much faster than the rover command loop can usefully
// react. Sending at a steady cadence keeps tiny thumb jitter and browser event bursts
// from turning into uneven wheel commands while still feeling live under one thumb.
export const JOYSTICK_SEND_INTERVAL_MS = 90;
export const JOYSTICK_SMOOTHING = 0.15;
export const AUX_ZERO = { main: 0, side: 0, vacuum: 0 };
export const AUX_ALL_FORWARD = { main: 127, side: 127, vacuum: 127 };
export const AUX_ALL_BACKWARD = { main: -127, side: -127, vacuum: -127 };
