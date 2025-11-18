/* global Buffer */

import { DRIVE_LIMITS } from './constants.js';

export function clamp(value, min, max) {
  if (typeof value !== 'number' || Number.isNaN(value)) return min;
  return Math.max(min, Math.min(max, value));
}

export function clampUnit(value) {
  if (typeof value !== 'number' || Number.isNaN(value)) return 0;
  return Math.max(-1, Math.min(1, value));
}

export function clampRange(value, range) {
  if (!Array.isArray(range) || range.length !== 2) return value;
  return clamp(value, range[0], range[1]);
}

export function normalizeDriveVector(vector = {}) {
  const x = clampUnit(vector.x ?? 0);
  const y = clampUnit(vector.y ?? 0);
  return {
    x,
    y,
    boost: Boolean(vector.boost),
  };
}

export function computeDifferentialSpeeds(vector = {}, options = {}) {
  const normalized = normalizeDriveVector(vector);
  const maxSpeed = typeof options.maxSpeed === 'number' ? options.maxSpeed : DRIVE_LIMITS.maxSpeed;
  const baseSpeed = typeof options.baseSpeed === 'number' ? options.baseSpeed : DRIVE_LIMITS.baseSpeed;
  const boostSpeed = typeof options.boostSpeed === 'number' ? options.boostSpeed : DRIVE_LIMITS.boostSpeed;
  const base = normalized.boost ? boostSpeed : baseSpeed;
  const forward = normalized.y * base;
  const turn = normalized.x * base;
  return {
    vector: normalized,
    speeds: {
      left: clamp(Math.round(forward + turn), -maxSpeed, maxSpeed),
      right: clamp(Math.round(forward - turn), -maxSpeed, maxSpeed),
    },
  };
}

export function bytesToBase64(bytes) {
  const safeBytes = Array.isArray(bytes) ? bytes : [];
  const binary = String.fromCharCode(...safeBytes);
  if (typeof btoa === 'function') return btoa(binary);
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(safeBytes).toString('base64');
  }
  throw new Error('No base64 encoder available');
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
