// PTZ Control Adapter
// Purpose: Hooks the single PTZ camera into the internal control action layer.
// Scope: Owns PTZ-specific control mixing and socket commands so keyboard,
// mobile, desktop, and gamepad inputs do not each learn camera-specific rules.
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useSocket } from '../context/SocketContext.jsx';
import { useSessionActions, useSessionSelector } from '../context/SessionContext.jsx';

const PTZ_STOP = { pan: 0, tilt: 0, zoom: 0 };
const PTZ_SPEEDS = {
  slow: 0.1,
  medium: 0.5,
  fast: 1,
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

function normalizeIrMode(mode) {
  const normalized = String(mode || '').trim().toLowerCase();
  if (normalized === 'on') return 'On';
  if (normalized === 'off') return 'Off';
  return 'Auto';
}

function nextIrMode(currentMode) {
  /*
    The rover laser button becomes the PTZ camera's IR mode control while the
    PTZ camera is active. Cycle all three modes exposed by this Reolink camera
    instead of reducing the control to a two-state toggle.
  */
  const current = normalizeIrMode(currentMode);
  if (current === 'Auto') return 'On';
  if (current === 'On') return 'Off';
  return 'Auto';
}

export function usePtzControlAdapter() {
  const socket = useSocket();
  const { ptzSpotlight, ptzIr } = useSessionActions();
  const ptz = useSessionSelector((state) => state.session?.ptzCamera || null);
  const isActive = Boolean(ptz?.isOperator);
  const lastMotionSignatureRef = useRef(payloadSignature(PTZ_STOP));
  const panTiltIntentRef = useRef({ pan: 0, tilt: 0 });
  const zoomIntentRef = useRef(0);
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
    // A true global stop is used for blur, route close, and control release, so
    // it deliberately clears every independently tracked PTZ axis intent.
    panTiltIntentRef.current = { pan: 0, tilt: 0 };
    zoomIntentRef.current = 0;
    const stopSignature = payloadSignature(PTZ_STOP);
    if (lastMotionSignatureRef.current === stopSignature) return;
    lastMotionSignatureRef.current = stopSignature;
    emitPtz('ptzCamera:stop');
  }, [emitPtz]);

  const sendMotion = useCallback(
    (payload, options = {}) => {
      if (!isActive) return false;
      const nextPayload = {
        pan: clampUnit(payload?.pan),
        tilt: clampUnit(payload?.tilt),
        zoom: clampUnit(payload?.zoom),
      };
      const nextSignature = payloadSignature(nextPayload);
      if (!options.force && lastMotionSignatureRef.current === nextSignature) return true;
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
      const panTilt = buildPanTiltPayload(vector, meta);
      panTiltIntentRef.current = {
        pan: panTilt.pan,
        tilt: panTilt.tilt,
      };
      /*
        ONVIF continuous movement accepts pan, tilt, and zoom in one command.
        Preserve the current zoom intent when a direction update arrives so a
        keyboard or touch event on one axis cannot erase another held axis.
      */
      sendMotion({
        ...panTiltIntentRef.current,
        zoom: zoomIntentRef.current,
      });
      return true;
    },
    [isActive, sendMotion],
  );

  const pulseZoom = useCallback(
    (direction) => {
      if (!isActive) return false;
      const sign = axisSign(direction);
      if (!sign) {
        if (zoomStopTimerRef.current) {
          clearTimeout(zoomStopTimerRef.current);
          zoomStopTimerRef.current = null;
        }
        zoomIntentRef.current = 0;
        /*
          Releasing zoom must not call the global PTZ stop. Re-emit the retained
          pan/tilt intent with zoom cleared so a held direction continues
          immediately instead of waiting for another directional key event.
        */
        sendMotion({ ...panTiltIntentRef.current, zoom: 0 }, { force: true });
        return true;
      }
      /*
        Zoom is different from pan/tilt because it is driven by repeated nudge
        events from existing camera controls. Force each pulse through even when
        the payload is identical, otherwise holding "camera up" only sends the
        first zoom command and every later nudge is de-duped away.
      */
      zoomIntentRef.current = sign * PTZ_SPEEDS.medium;
      sendMotion({
        ...panTiltIntentRef.current,
        zoom: zoomIntentRef.current,
      }, { force: true });
      if (zoomStopTimerRef.current) clearTimeout(zoomStopTimerRef.current);
      /*
        Existing rover camera controls are nudge/slider based, not hold-based.
        Treat each nudge as a short PTZ zoom pulse, then stop from the adapter
        so delayed stop behavior is owned by the camera layer only.
      */
      zoomStopTimerRef.current = setTimeout(() => {
        zoomStopTimerRef.current = null;
        zoomIntentRef.current = 0;
        // A zoom pulse ending restores, rather than stops, any direction that
        // is still held in the independent pan/tilt intent.
        sendMotion({ ...panTiltIntentRef.current, zoom: 0 }, { force: true });
      }, ZOOM_PULSE_MS);
      return true;
    },
    [isActive, sendMotion],
  );

  const setSpotlight = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const desiredOn = typeof nextOn === 'boolean' ? nextOn : !isSpotlightOn(ptz?.light);
      /*
        Lighting keybinds should use the exact acknowledged command action as
        the visible PTZ buttons. Movement remains fire-and-forget because it is
        continuous and high frequency, but a discrete light toggle benefits
        from the existing authorization/error contract and must not maintain a
        second socket-only behavior merely because its source is a keybind.
      */
      ptzSpotlight({ state: desiredOn ? 1 : 0 }).catch(() => {});
      return true;
    },
    [isActive, ptz?.light, ptzSpotlight],
  );

  const setIr = useCallback(
    (nextOn) => {
      if (!isActive) return false;
      const desiredState = typeof nextOn === 'boolean'
        ? (nextOn ? 'On' : 'Off')
        : nextIrMode(ptz?.ir?.state);
      // Match the button path for the same reason as spotlight above. The
      // shared laser key continues to select IR; only its transport is unified.
      ptzIr({ state: desiredState }).catch(() => {});
      return true;
    },
    [isActive, ptz?.ir?.state, ptzIr],
  );

  useEffect(() => {
    if (isActive) return undefined;
    lastMotionSignatureRef.current = payloadSignature(PTZ_STOP);
    panTiltIntentRef.current = { pan: 0, tilt: 0 };
    zoomIntentRef.current = 0;
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
