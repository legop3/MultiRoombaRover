// PTZ Control Adapter
// Purpose: Hooks the single PTZ camera into the internal control action layer.
// Scope: Owns PTZ-specific control mixing and socket commands so keyboard,
// mobile, desktop, and gamepad inputs do not each learn camera-specific rules.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionSelector } from '../context/SessionContext.jsx';

const PTZ_STOP = { pan: 0, tilt: 0, zoom: 0 };
const PTZ_SPEEDS = {
  slow: 0.22,
  medium: 0.45,
  fast: 0.72,
};
const ZOOM_PULSE_MS = 220;

function clampUnit(value) {
  const number = Number(value) || 0;
  return Math.max(-1, Math.min(1, number));
}

function axisSign(value) {
  const number = Number(value) || 0;
  if (number > 0.05) return 1;
  if (number < -0.05) return -1;
  return 0;
}

function pickPanTiltSpeed(vector = {}, meta = {}) {
  /*
    PTZ movement should not inherit rover wheel speeds. Inputs only choose a
    speed tier here: precision/low-magnitude input is slow, normal input is
    medium, and explicit boost is fast. That gives every control surface the
    same camera feel without remixing differential-drive output.
  */
  if (vector?.boost) return PTZ_SPEEDS.fast;
  const maxAxis = Math.max(Math.abs(Number(vector?.x) || 0), Math.abs(Number(vector?.y) || 0));
  const baseSpeed = Number(meta?.speedOptions?.baseSpeed);
  if (maxAxis > 0 && maxAxis <= 0.45) return PTZ_SPEEDS.slow;
  if (Number.isFinite(baseSpeed) && baseSpeed > 0 && baseSpeed <= 150) return PTZ_SPEEDS.slow;
  return PTZ_SPEEDS.medium;
}

function payloadSignature(payload = PTZ_STOP) {
  return [
    Number(payload.pan || 0).toFixed(3),
    Number(payload.tilt || 0).toFixed(3),
    Number(payload.zoom || 0).toFixed(3),
  ].join(':');
}

function isIdlePayload(payload = PTZ_STOP) {
  return !payload.pan && !payload.tilt && !payload.zoom;
}

function buildPanTiltPayload(vector = {}, meta = {}) {
  const panSign = axisSign(vector.x);
  const tiltSign = axisSign(vector.y);
  if (!panSign && !tiltSign) return PTZ_STOP;

  const speed = pickPanTiltSpeed(vector, meta);
  const diagonalScale = panSign && tiltSign ? Math.SQRT1_2 : 1;
  return {
    pan: clampUnit(panSign * speed * diagonalScale),
    tilt: clampUnit(tiltSign * speed * diagonalScale),
    zoom: 0,
  };
}

function isSpotlightOn(light = {}) {
  if (typeof light?.on === 'boolean') return light.on;
  const raw = light?.state;
  if (typeof raw === 'string') {
    const normalized = raw.trim().toLowerCase();
    return !['', '0', 'off', 'false'].includes(normalized);
  }
  return Boolean(Number(raw));
}

export function usePtzControlAdapter() {
  const socket = useSocket();
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isActive = Boolean(ptz?.isOperator);
  const lastMotionSignatureRef = useRef(payloadSignature(PTZ_STOP));
  const zoomStopTimerRef = useRef(null);

  const emitPtz = useCallback(
    (eventName, payload = {}) => {
      if (!socket || !isActive) return;
      socket.emit(eventName, payload);
    },
    [isActive, socket],
  );

  const stopMotion = useCallback(() => {
    if (zoomStopTimerRef.current) {
      clearTimeout(zoomStopTimerRef.current);
      zoomStopTimerRef.current = null;
    }
    const stopSignature = payloadSignature(PTZ_STOP);
    if (lastMotionSignatureRef.current === stopSignature) return;
    lastMotionSignatureRef.current = stopSignature;
    emitPtz('ptzCamera:stop');
  }, [emitPtz]);

  const sendMotion = useCallback(
    (payload) => {
      if (!isActive) return false;
      const nextPayload = {
        pan: clampUnit(payload?.pan),
        tilt: clampUnit(payload?.tilt),
        zoom: clampUnit(payload?.zoom),
      };
      const nextSignature = payloadSignature(nextPayload);
      if (lastMotionSignatureRef.current === nextSignature) return true;
      lastMotionSignatureRef.current = nextSignature;
      if (isIdlePayload(nextPayload)) {
        emitPtz('ptzCamera:stop');
      } else {
        emitPtz('ptzCamera:move', nextPayload);
      }
      return true;
    },
    [emitPtz, isActive],
  );

  const applyDriveVector = useCallback(
    (vector, meta = {}) => {
      if (!isActive) return false;
      sendMotion(buildPanTiltPayload(vector, meta));
      return true;
    },
    [isActive, sendMotion],
  );

  const pulseZoom = useCallback(
    (direction) => {
      if (!isActive) return false;
      const sign = axisSign(direction);
      if (!sign) {
        stopMotion();
        return true;
      }
      sendMotion({ pan: 0, tilt: 0, zoom: sign * PTZ_SPEEDS.medium });
      if (zoomStopTimerRef.current) clearTimeout(zoomStopTimerRef.current);
      /*
        Existing rover camera controls are nudge/slider based, not hold-based.
        Treat each nudge as a short PTZ zoom pulse, then stop from the adapter
        so delayed stop behavior is owned by the camera layer only.
      */
      zoomStopTimerRef.current = setTimeout(() => {
        zoomStopTimerRef.current = null;
        stopMotion();
      }, ZOOM_PULSE_MS);
      return true;
    },
    [isActive, sendMotion, stopMotion],
  );

  const setSpotlight = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const desiredOn = typeof nextOn === 'boolean' ? nextOn : !isSpotlightOn(ptz?.light);
      emitPtz('ptzCamera:spotlight', { state: desiredOn ? 1 : 0 });
      return true;
    },
    [emitPtz, isActive, ptz?.light],
  );

  const setIr = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const currentOff = String(ptz?.ir?.state || '').toLowerCase() === 'off';
      const desiredState = typeof nextOn === 'boolean' ? (nextOn ? 'Auto' : 'Off') : currentOff ? 'Auto' : 'Off';
      emitPtz('ptzCamera:ir', { state: desiredState });
      return true;
    },
    [emitPtz, isActive, ptz?.ir?.state],
  );

  useEffect(() => {
    if (isActive) return undefined;
    lastMotionSignatureRef.current = payloadSignature(PTZ_STOP);
    if (zoomStopTimerRef.current) {
      clearTimeout(zoomStopTimerRef.current);
      zoomStopTimerRef.current = null;
    }
    return undefined;
  }, [isActive]);

  useEffect(
    () => () => {
      if (zoomStopTimerRef.current) clearTimeout(zoomStopTimerRef.current);
    },
    [],
  );

  return useMemo(
    () => ({
      isActive,
      state: ptz,
      applyDriveVector,
      pulseZoom,
      setSpotlight,
      setIr,
      stopMotion,
    }),
    [applyDriveVector, isActive, ptz, pulseZoom, setIr, setSpotlight, stopMotion],
  );
}
