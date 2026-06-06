// Kinect Panel Utilities
// Purpose: Keeps small normalization helpers out of the visual component files.
// Scope: Handles session status defaults, socket binary payload conversion, and title-bar status pill state.
export const EMPTY_KINECT_STATUS = {
  enabled: false,
  available: false,
  busy: false,
  captureCooldownUntil: 0,
  lastError: null,
  hasPointCloud: false,
  hasColorImage: false,
};

export function normalizeKinectStatus(status) {
  return {
    ...EMPTY_KINECT_STATUS,
    ...(status && typeof status === 'object' ? status : {}),
  };
}

export function normalizeBinaryPayload(buffer) {
  if (!buffer) return null;
  if (buffer instanceof ArrayBuffer) return buffer;
  if (ArrayBuffer.isView(buffer)) {
    return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
  }
  return null;
}

export function buildStatusPill({ cooldownText, enabled, busy, lastError }) {
  if (cooldownText) {
    return {
      label: cooldownText,
      className: 'border-red-400 bg-red-600 text-red-50',
    };
  }
  if (!enabled || lastError) {
    return {
      label: 'Off',
      className: 'border-red-400 bg-red-700 text-red-50',
    };
  }
  if (busy) {
    return {
      label: '...',
      className: 'border-amber-200 bg-amber-500 text-amber-950',
    };
  }
  return {
    label: 'Ready',
    className: 'border-emerald-300 bg-emerald-600 text-emerald-50',
  };
}
